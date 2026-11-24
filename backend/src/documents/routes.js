"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const { requireAuth } = require("../auth/middleware");
const { writeAudit } = require("../http/audit");
const { ApiError, mapFabricError, validate } = require("../http/errors");
const { requireRole } = require("../auth/middleware");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const validType = (
      (extension === ".pdf" && file.mimetype === "application/pdf")
      || (extension === ".png" && file.mimetype === "image/png")
      || ([".jpg", ".jpeg"].includes(extension) && file.mimetype === "image/jpeg")
    );
    callback(validType ? null : new ApiError(
      400,
      "UNSUPPORTED_FILE_TYPE",
      "Only PDF, PNG and JPEG files are accepted"
    ), validType);
  }
});

const batchIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);

function identifyFile(buffer, mimeType) {
  const isPdf = mimeType === "application/pdf" && buffer.subarray(0, 5).toString() === "%PDF-";
  const isPng = mimeType === "image/png"
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = mimeType === "image/jpeg"
    && buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff;
  return isPdf || isPng || isJpeg;
}

function sanitizedFilename(filename) {
  return filename.replace(/\\/g, "/").split("/").pop().slice(0, 255);
}

function createDocumentRouter({
  dbPool,
  fabricGateway,
  fileStoragePath,
  publicReader,
  logger = console
}) {
  const router = express.Router();
  const authenticate = requireAuth(dbPool);

  async function findAccessibleDocument(request, storageId) {
    const result = await dbPool.query(
      `SELECT storage_id, batch_id, original_name, mime_type, size_bytes, sha256, uploaded_by
       FROM file_metadata WHERE storage_id = $1`,
      [storageId]
    );
    const document = result.rows[0];
    if (!document) throw new ApiError(404, "NOT_FOUND", "The requested document was not found");

    if (
      request.user.id === document.uploaded_by
      || ["auditor", "system_admin"].includes(request.user.role)
    ) {
      return document;
    }

    let batch;
    try {
      batch = JSON.parse(await fabricGateway.evaluate(publicReader, "GetBatch", document.batch_id));
    } catch (error) {
      throw mapFabricError(error);
    }
    if (
      !request.user.organization_msp
      || ![batch.ownerMsp, batch.currentOwnerMsp].includes(request.user.organization_msp)
    ) {
      throw new ApiError(403, "FORBIDDEN", "The current identity is not allowed to access this document");
    }
    return document;
  }

  router.post(
    "/",
    authenticate,
    requireRole("harvest_operator", "processing_operator", "quality_inspector", "distributor", "auditor"),
    upload.single("file"),
    async (request, response) => {
      if (!request.file) throw new ApiError(400, "INVALID_ARGUMENT", "A document file is required");
      const batchId = validate(batchIdSchema, request.body.batchId);
      if (!identifyFile(request.file.buffer, request.file.mimetype)) {
        throw new ApiError(400, "INVALID_FILE_CONTENT", "The file content does not match its declared type");
      }
      let batch;
      try {
        batch = JSON.parse(await fabricGateway.evaluate(publicReader, "GetBatch", batchId));
      } catch (error) {
        throw mapFabricError(error);
      }
      if (
        !request.user.organization_msp
        || ![batch.ownerMsp, batch.currentOwnerMsp].includes(request.user.organization_msp)
      ) {
        throw new ApiError(403, "FORBIDDEN", "The current identity is not allowed to attach a document to this batch");
      }

      const storageId = crypto.randomUUID();
      const checksum = crypto.createHash("sha256").update(request.file.buffer).digest("hex");
      const filename = path.join(fileStoragePath, storageId);
      await fs.mkdir(fileStoragePath, { recursive: true });
      await fs.writeFile(filename, request.file.buffer, { flag: "wx", mode: 0o600 });

      let client;
      try {
        client = await dbPool.connect();
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO file_metadata
             (storage_id, batch_id, original_name, mime_type, size_bytes, sha256, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            storageId,
            batchId,
            sanitizedFilename(request.file.originalname),
            request.file.mimetype,
            request.file.size,
            checksum,
            request.user.id
          ]
        );
        await writeAudit(dbPool, {
          requestId: request.requestId,
          userId: request.user.id,
          action: "document.upload",
          target: storageId,
          outcome: "success",
          details: { batchId, sha256: checksum, sizeBytes: request.file.size }
        });
        await client.query("COMMIT");
      } catch (error) {
        if (client) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            logger.error(JSON.stringify({
              event: "document_upload_rollback_failed",
              requestId: request.requestId,
              storageId,
              code: rollbackError.code || "UNKNOWN"
            }));
          }
        }
        try {
          await fs.unlink(filename);
        } catch (cleanupError) {
          logger.error(JSON.stringify({
            event: "document_upload_cleanup_failed",
            requestId: request.requestId,
            storageId,
            code: cleanupError.code || "UNKNOWN"
          }));
        }
        throw error;
      } finally {
        if (client) client.release();
      }

      response.status(201).json({
        document: {
          storageId,
          batchId,
          originalName: sanitizedFilename(request.file.originalname),
          mimeType: request.file.mimetype,
          sizeBytes: request.file.size,
          sha256: checksum
        }
      });
    }
  );

  router.get("/:storageId", authenticate, async (request, response, next) => {
    const storageId = validate(z.string().uuid(), request.params.storageId);
    const document = await findAccessibleDocument(request, storageId);
    const filename = path.join(fileStoragePath, storageId);
    response.download(filename, document.original_name, (error) => {
      if (!error) return;
      logger.error(JSON.stringify({
        event: "document_download_failed",
        requestId: request.requestId,
        storageId,
        code: error.code || "UNKNOWN"
      }));
      if (!response.headersSent) next(error);
    });
  });

  router.post("/:storageId/verify", authenticate, async (request, response) => {
    const storageId = validate(z.string().uuid(), request.params.storageId);
    const document = await findAccessibleDocument(request, storageId);
    const filename = path.join(fileStoragePath, storageId);
    const contents = await fs.readFile(filename);
    const checksum = crypto.createHash("sha256").update(contents).digest("hex");
    let ledgerResult;
    try {
      ledgerResult = JSON.parse(await fabricGateway.evaluate(
        publicReader,
        "VerifyDocumentHash",
        document.batch_id,
        checksum
      ));
    } catch (error) {
      throw mapFabricError(error);
    }
    response.json({
      storageId,
      sha256: checksum,
      matchesUploadMetadata: checksum === document.sha256,
      verifiedOnLedger: ledgerResult.verified
    });
  });

  return router;
}

module.exports = { createDocumentRouter, identifyFile, sanitizedFilename };
