"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createApp } = require("../src/app");

const accessToken = "c".repeat(64);
const user = {
  id: "00000000-0000-4000-8000-000000000003",
  username: "harvest.operator",
  display_name: "Harvest Operator",
  organization_msp: "OrgHarvestMSP",
  role: "harvest_operator",
  fabric_identity: "harvest.operator"
};
const pdf = Buffer.from("%PDF-1.4\nYen sao certificate\n%%EOF\n");

let server;
let baseUrl;
let storagePath;
let uploadedDocument;
let ledgerEvaluations;

before(async () => {
  storagePath = await fs.mkdtemp(path.join(os.tmpdir(), "yen-sao-documents-"));
  uploadedDocument = null;
  ledgerEvaluations = [];
  const client = {
    query: async (sql, parameters = []) => {
      if (sql.includes("INSERT INTO file_metadata")) {
        uploadedDocument = {
          storage_id: parameters[0],
          batch_id: parameters[1],
          original_name: parameters[2],
          mime_type: parameters[3],
          size_bytes: parameters[4],
          sha256: parameters[5],
          uploaded_by: parameters[6]
        };
      }
      return { rows: [], rowCount: 1 };
    },
    release: () => undefined
  };
  const dbPool = {
    connect: async () => client,
    query: async (sql) => {
      if (sql.includes("FROM sessions")) {
        return { rows: [user], rowCount: 1 };
      }
      if (sql.includes("FROM file_metadata")) {
        return { rows: uploadedDocument ? [uploadedDocument] : [], rowCount: uploadedDocument ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
  const fabricGateway = {
    checkReady: async () => undefined,
    evaluate: async (_identity, transactionName, ...args) => {
      ledgerEvaluations.push({ transactionName, args });
      if (transactionName === "GetBatch") {
        return JSON.stringify({
          ownerMsp: "OrgHarvestMSP",
          currentOwnerMsp: "OrgHarvestMSP"
        });
      }
      if (transactionName === "VerifyDocumentHash") {
        return JSON.stringify({ verified: args[1] === uploadedDocument.sha256 });
      }
      throw new Error(`Unexpected Fabric query: ${transactionName}`);
    }
  };
  server = createApp({
    dbPool,
    fabricGateway,
    fileStoragePath: storagePath
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await fs.rm(storagePath, { recursive: true, force: true });
});

function documentForm(contents, mimeType, filename = "certificate.pdf") {
  const form = new FormData();
  form.append("batchId", "YEN-TEST-02");
  form.append("file", new Blob([contents], { type: mimeType }), filename);
  return form;
}

test("document upload stores a checksum and verification compares against Fabric", async () => {
  const response = await fetch(`${baseUrl}/api/v1/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: documentForm(pdf, "application/pdf")
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.document.batchId, "YEN-TEST-02");
  assert.equal(body.document.sha256, crypto.createHash("sha256").update(pdf).digest("hex"));
  assert.equal((await fs.readFile(path.join(storagePath, body.document.storageId))).equals(pdf), true);

  const verifyResponse = await fetch(
    `${baseUrl}/api/v1/documents/${body.document.storageId}/verify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  assert.equal(verifyResponse.status, 200);
  assert.deepEqual(await verifyResponse.json(), {
    storageId: body.document.storageId,
    sha256: body.document.sha256,
    matchesUploadMetadata: true,
    verifiedOnLedger: true
  });
  assert.deepEqual(ledgerEvaluations.map((call) => call.transactionName), [
    "GetBatch",
    "VerifyDocumentHash"
  ]);
});

test("document upload rejects content that does not match the declared MIME type", async () => {
  const response = await fetch(`${baseUrl}/api/v1/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: documentForm("not a PDF", "application/pdf")
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_FILE_CONTENT");
});
