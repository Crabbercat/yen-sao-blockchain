"use strict";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApp } = require("../src/app");
const { hashToken } = require("../src/auth/middleware");
const { mapFabricError } = require("../src/http/errors");

const accessToken = "a".repeat(64);
const processingToken = "b".repeat(64);
const distributorToken = "c".repeat(64);
const users = {
  harvest: {
    id: "00000000-0000-4000-8000-000000000001",
    username: "harvest.operator",
    display_name: "Harvest Operator",
    organization_msp: "OrgHarvestMSP",
    role: "harvest_operator",
    fabric_identity: "harvest.operator"
  },
  processing: {
    id: "00000000-0000-4000-8000-000000000002",
    username: "processing.operator",
    display_name: "Processing Operator",
    organization_msp: "OrgProcessingMSP",
    role: "processing_operator",
    fabric_identity: "processing.operator"
  },
  distributor: {
    id: "00000000-0000-4000-8000-000000000003",
    username: "distributor.operator",
    display_name: "Distributor",
    organization_msp: "OrgDistributionMSP",
    role: "distributor",
    fabric_identity: "distributor.operator"
  }
};

let server;
let baseUrl;
let submitted;
let privateSubmission;
let evaluated;

before(async () => {
  const dbPool = {
    query: async (sql, parameters = []) => {
      if (sql.includes("FROM sessions")) {
        const user = parameters[0] === hashToken(processingToken)
          ? users.processing
          : parameters[0] === hashToken(distributorToken)
            ? users.distributor
            : users.harvest;
        return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
  const fabricGateway = {
    checkReady: async () => undefined,
    submit: async (user, transactionName, input) => {
      submitted = { user, transactionName, input };
      return JSON.stringify(input);
    },
    submitTransient: async (user, transactionName, args, transientData) => {
      privateSubmission = { user, transactionName, args, transientData };
      return JSON.stringify({ batchId: args[0].batchId, stored: true });
    },
    evaluate: async (user, transactionName, ...args) => {
      evaluated = { user, transactionName, args };
      if (transactionName === "GetShipment") {
        return JSON.stringify({
          shipmentId: args[0],
          status: "ACCEPTED",
          batchIds: ["YEN-TEST-01"]
        });
      }
      return JSON.stringify({ batchId: args[0] });
    }
  };
  server = createApp({ dbPool, fabricGateway }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("protected ledger transactions require a bearer token", async () => {
  const response = await fetch(`${baseUrl}/api/v1/batches/harvest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
});

test("harvest creation enforces role, validates input and submits to Fabric", async () => {
  const request = {
    batchId: "YEN-TEST-01",
    eventId: "EVENT-TEST-01",
    species: "Swiftlet",
    harvestLocation: "Cu Lao Cham",
    harvestedAt: "2026-03-01T10:00:00Z",
    quantity: 2,
    unit: "kg"
  };
  const denied = await fetch(`${baseUrl}/api/v1/batches/harvest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${processingToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "FORBIDDEN");

  const accepted = await fetch(`${baseUrl}/api/v1/batches/harvest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });
  assert.equal(accepted.status, 201);

  assert.equal(submitted.transactionName, "CreateHarvestBatch");
  assert.deepEqual(submitted.input, request);
  assert.equal(submitted.user.fabric_identity, "harvest.operator");
});

test("public trace uses the public chaincode transaction without authentication", async () => {
  const response = await fetch(`${baseUrl}/api/v1/trace/YEN-TEST-01`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { batchId: "YEN-TEST-01" });
  assert.equal(evaluated.transactionName, "GetPublicTrace");
  assert.equal(evaluated.args[0], "YEN-TEST-01");
});

test("public trace QR returns a downloadable PNG", async () => {
  const response = await fetch(`${baseUrl}/api/v1/trace/YEN-TEST-01/qr?download=1`);
  const image = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /image\/png/);
  assert.match(response.headers.get("content-disposition"), /YEN-TEST-01-trace\.png/);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("distribution verifies accepted shipment membership from Fabric", async () => {
  const response = await fetch(`${baseUrl}/api/v1/shipments/SHIP-TEST-01/distribute`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${distributorToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      batchId: "YEN-TEST-01",
      shipmentId: "SHIP-TEST-01",
      eventId: "EVENT-DISTRIBUTION-01",
      distributionId: "DIST-TEST-01",
      location: "Cu Lao Cham"
    })
  });

  assert.equal(response.status, 200);
  assert.equal(evaluated.transactionName, "GetShipment");
  assert.deepEqual(submitted.input, {
    batchId: "YEN-TEST-01",
    shipmentId: "SHIP-TEST-01",
    eventId: "EVENT-DISTRIBUTION-01",
    distributionId: "DIST-TEST-01",
    location: "Cu Lao Cham"
  });
  assert.equal(submitted.transactionName, "RecordDistribution");
});

test("private commercial terms are sent only as Fabric transient data", async () => {
  const response = await fetch(`${baseUrl}/api/v1/batches/YEN-TEST-01/private-terms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      eventId: "PRIVATE-EVENT-01",
      privateTerms: {
        commercialPrice: 125,
        contractReference: "PRIVATE-CONTRACT-01",
        supplierNotes: "Confidential"
      }
    })
  });

  assert.equal(response.status, 201);
  assert.equal(privateSubmission.transactionName, "StorePrivateCommercialTerms");
  assert.deepEqual(privateSubmission.args, [{
    batchId: "YEN-TEST-01",
    eventId: "PRIVATE-EVENT-01"
  }]);
  assert.deepEqual(privateSubmission.transientData, {
    privateTerms: JSON.stringify({
      commercialPrice: 125,
      contractReference: "PRIVATE-CONTRACT-01",
      supplierNotes: "Confidential"
    })
  });
});

test("Fabric peer detail errors preserve domain error codes", () => {
  const error = mapFabricError({
    message: "10 ABORTED: failed to endorse transaction, see attached details for more info",
    details: [{
      message: "chaincode response 500, NOT_FOUND: Shipment was not found"
    }]
  });

  assert.equal(error.status, 404);
  assert.equal(error.code, "NOT_FOUND");
  assert.equal(error.message, "The requested ledger record was not found");
});
