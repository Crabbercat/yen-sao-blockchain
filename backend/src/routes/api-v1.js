"use strict";

const express = require("express");
const { z } = require("zod");
const QRCode = require("qrcode");
const { writeAudit } = require("../http/audit");
const { ApiError, mapFabricError, validate } = require("../http/errors");
const { requireAuth, requireRole } = require("../auth/middleware");

const batchId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const eventId = batchId;
const unit = z.enum(["g", "kg", "piece"]);
const positiveQuantity = z.number().finite().positive();
const eventFields = { eventId };

const harvestSchema = z.object({
  batchId,
  ...eventFields,
  species: z.string().trim().min(1).max(100),
  harvestLocation: z.string().trim().min(1).max(256),
  harvestedAt: z.string().datetime({ offset: true }),
  quantity: positiveQuantity,
  unit
}).strict();
const eventSchema = z.object({ eventId }).strict();
const handoverSchema = z.object({
  ...eventFields,
  recipientMsp: z.literal("OrgProcessingMSP")
}).strict();
const processingSchema = z.object({
  ...eventFields,
  recordId: batchId,
  outputBatchId: batchId,
  inputBatches: z.array(z.object({
    batchId,
    quantityUsed: positiveQuantity,
    unit
  }).strict()).min(1),
  processType: z.string().trim().min(1).max(100),
  facilityId: z.string().trim().min(1).max(100),
  notes: z.string().max(1000).optional()
}).strict();
const derivedSchema = z.object({
  ...eventFields,
  batchId,
  batchType: z.string().max(40).optional(),
  species: z.string().max(100).optional(),
  quantity: positiveQuantity,
  unit,
  inputBatches: z.array(z.object({
    batchId,
    quantityUsed: positiveQuantity,
    unit
  }).strict()).min(1)
}).strict();
const qualitySchema = z.object({
  ...eventFields,
  qualityId: batchId,
  result: z.enum(["PASS", "FAIL"]),
  standardCode: z.string().trim().min(1).max(100),
  certificateHash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  documentRef: z.string().max(256).optional()
}).strict();
const packageSchema = z.object({
  ...eventFields,
  certificateHash: z.string().regex(/^[a-fA-F0-9]{64}$/)
}).strict();
const shipmentSchema = z.object({
  ...eventFields,
  shipmentId: batchId,
  batchIds: z.array(batchId).min(1),
  toMsp: z.literal("OrgDistributionMSP")
}).strict();
const distributionSchema = z.object({
  ...eventFields,
  batchId,
  shipmentId: batchId,
  distributionId: batchId,
  location: z.string().trim().min(1).max(256)
}).strict();
const privateTermsSchema = z.object({
  eventId,
  privateTerms: z.object({
    commercialPrice: positiveQuantity.optional(),
    contractReference: z.string().max(128).optional(),
    supplierNotes: z.string().max(500).optional()
  }).strict()
}).strict();

const OPERATOR_ROLES = [
  "harvest_operator",
  "processing_operator",
  "quality_inspector",
  "distributor",
  "auditor",
  "system_admin"
];

function parseLedgerResult(result) {
  try {
    return JSON.parse(result);
  } catch {
    throw new ApiError(502, "FABRIC_RESPONSE_INVALID", "Fabric returned an invalid response");
  }
}

function createApiRouter({
  dbPool,
  fabricGateway,
  logger = console,
  publicReader,
  publicBaseUrl = "http://localhost:3000"
}) {
  const router = express.Router();
  const authenticate = requireAuth(dbPool);

  async function submit(request, transactionName, input, target, transientData) {
    let result;
    try {
      result = transientData
        ? await fabricGateway.submitTransient(request.user, transactionName, [input], transientData)
        : await fabricGateway.submit(request.user, transactionName, input);
    } catch (error) {
      try {
        await writeAudit(dbPool, {
          requestId: request.requestId,
          userId: request.user.id,
          action: `fabric.${transactionName}`,
          target,
          outcome: "failure"
        });
      } catch (auditError) {
        logger.error(JSON.stringify({
          event: "audit_write_failed",
          requestId: request.requestId,
          action: `fabric.${transactionName}`,
          code: auditError.code || "UNKNOWN"
        }));
      }
      throw mapFabricError(error);
    }

    try {
      await writeAudit(dbPool, {
        requestId: request.requestId,
        userId: request.user.id,
        action: `fabric.${transactionName}`,
        target,
        outcome: "success"
      });
    } catch (error) {
      logger.error(JSON.stringify({
        event: "audit_write_failed",
        requestId: request.requestId,
        action: `fabric.${transactionName}`,
        ledgerCommitted: true,
        code: error.code || "UNKNOWN"
      }));
      throw new ApiError(500, "AUDIT_LOG_FAILED", "The ledger transaction committed but its audit record could not be stored");
    }
    return parseLedgerResult(result);
  }

  async function evaluate(user, transactionName, ...args) {
    try {
      const readIdentity = user.organization_msp ? user : publicReader;
      return parseLedgerResult(await fabricGateway.evaluate(readIdentity, transactionName, ...args));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw mapFabricError(error);
    }
  }

  router.get("/trace/:batchId/qr", async (request, response) => {
    const id = validate(batchId, request.params.batchId);
    const traceUrl = new URL(`/trace/${encodeURIComponent(id)}`, publicBaseUrl).toString();
    const image = await QRCode.toBuffer(traceUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      type: "png",
      width: 256
    });
    response.type("png");
    response.set("Cache-Control", "public, max-age=300");
    if (request.query.download === "1") {
      response.set("Content-Disposition", `attachment; filename="${id}-trace.png"`);
    }
    response.send(image);
  });

  router.get("/trace/:batchId", async (request, response) => {
    const id = validate(batchId, request.params.batchId);
    response.json(await evaluate(publicReader, "GetPublicTrace", id));
  });

  router.get("/batches", authenticate, requireRole(...OPERATOR_ROLES), async (request, response) => {
    response.json({ batches: await evaluate(request.user, "GetBatches") });
  });

  router.post(
    "/batches/harvest",
    authenticate,
    requireRole("harvest_operator"),
    async (request, response) => {
      const input = validate(harvestSchema, request.body);
      response.status(201).json({
        batch: await submit(request, "CreateHarvestBatch", input, input.batchId)
      });
    }
  );

  router.get("/batches/:batchId", authenticate, requireRole(...OPERATOR_ROLES), async (request, response) => {
    const id = validate(batchId, request.params.batchId);
    response.json({ batch: await evaluate(request.user, "GetBatch", id) });
  });

  router.post(
    "/batches/:batchId/handover",
    authenticate,
    requireRole("harvest_operator", "processing_operator"),
    async (request, response) => {
      const id = validate(batchId, request.params.batchId);
      const body = validate(handoverSchema, request.body);
      response.status(201).json({
        batch: await submit(request, "CreateHandover", { ...body, batchId: id }, id)
      });
    }
  );

  router.post(
    "/transfers/:transferId/accept",
    authenticate,
    requireRole("processing_operator", "distributor"),
    async (request, response) => {
      const id = validate(batchId, request.params.transferId);
      const body = validate(eventSchema, request.body);
      response.json({
        batch: await submit(request, "AcceptHandover", { ...body, batchId: id }, id)
      });
    }
  );

  router.post(
    "/batches/:batchId/processing",
    authenticate,
    requireRole("processing_operator"),
    async (request, response) => {
      const id = validate(batchId, request.params.batchId);
      const input = validate(processingSchema, request.body);
      if (!input.inputBatches.some((item) => item.batchId === id)) {
        throw new ApiError(400, "INVALID_ARGUMENT", "The path batchId must be included in inputBatches");
      }
      response.status(201).json({
        processing: await submit(request, "RecordProcessing", input, id)
      });
    }
  );

  router.post(
    "/batches/:batchId/derived",
    authenticate,
    requireRole("processing_operator"),
    async (request, response) => {
      const parentId = validate(batchId, request.params.batchId);
      const input = validate(derivedSchema, request.body);
      if (!input.inputBatches.some((item) => item.batchId === parentId)) {
        throw new ApiError(400, "INVALID_ARGUMENT", "The path batchId must be included in inputBatches");
      }
      response.status(201).json({
        batch: await submit(request, "CreateDerivedBatch", input, input.batchId)
      });
    }
  );

  router.post(
    "/batches/:batchId/quality",
    authenticate,
    requireRole("quality_inspector"),
    async (request, response) => {
      const id = validate(batchId, request.params.batchId);
      const input = validate(qualitySchema, request.body);
      response.status(201).json({
        quality: await submit(request, "RecordQualityCheck", { ...input, batchId: id }, id)
      });
    }
  );

  router.post(
    "/batches/:batchId/private-terms",
    authenticate,
    requireRole("harvest_operator", "processing_operator"),
    async (request, response) => {
      const id = validate(batchId, request.params.batchId);
      const input = validate(privateTermsSchema, request.body);
      response.status(201).json({
        terms: await submit(
          request,
          "StorePrivateCommercialTerms",
          { batchId: id, eventId: input.eventId },
          id,
          { privateTerms: JSON.stringify(input.privateTerms) }
        )
      });
    }
  );

  router.get(
    "/batches/:batchId/private-terms",
    authenticate,
    requireRole("harvest_operator", "processing_operator"),
    async (request, response) => {
      const id = validate(batchId, request.params.batchId);
      response.json({ terms: await evaluate(request.user, "GetPrivateCommercialTerms", id) });
    }
  );

  router.post(
    "/batches/:batchId/package",
    authenticate,
    requireRole("processing_operator"),
    async (request, response) => {
      const id = validate(batchId, request.params.batchId);
      const input = validate(packageSchema, request.body);
      response.json({
        batch: await submit(request, "PackageBatch", { ...input, batchId: id }, id)
      });
    }
  );

  router.post(
    "/shipments",
    authenticate,
    requireRole("processing_operator"),
    async (request, response) => {
      const input = validate(shipmentSchema, request.body);
      response.status(201).json({
        shipment: await submit(request, "CreateShipment", input, input.shipmentId)
      });
    }
  );

  router.post(
    "/shipments/:shipmentId/accept",
    authenticate,
    requireRole("distributor"),
    async (request, response) => {
      const id = validate(batchId, request.params.shipmentId);
      const body = validate(eventSchema, request.body);
      response.json({
        shipment: await submit(request, "AcceptShipment", { ...body, shipmentId: id }, id)
      });
    }
  );

  router.post(
    "/shipments/:shipmentId/distribute",
    authenticate,
    requireRole("distributor"),
    async (request, response) => {
      const shipmentId = validate(batchId, request.params.shipmentId);
      const input = validate(distributionSchema, request.body);
      if (input.shipmentId !== shipmentId) {
        throw new ApiError(400, "INVALID_ARGUMENT", "The shipment ID in the path and request body must match");
      }
      const shipment = await evaluate(request.user, "GetShipment", shipmentId);
      if (shipment.status !== "ACCEPTED" || !shipment.batchIds.includes(input.batchId)) {
        throw new ApiError(409, "INVALID_STATE", "The batch is not part of the specified shipment");
      }
      response.json({
        batch: await submit(request, "RecordDistribution", input, input.batchId)
      });
    }
  );

  router.get(
    "/batches/:batchId/history",
    authenticate,
    requireRole(...OPERATOR_ROLES),
    async (request, response) => {
      const id = validate(batchId, request.params.batchId);
      response.json({ history: await evaluate(request.user, "GetBatchHistory", id) });
    }
  );

  router.get(
    "/batches/:batchId/lineage",
    authenticate,
    requireRole(...OPERATOR_ROLES),
    async (request, response) => {
      const id = validate(batchId, request.params.batchId);
      response.json({ lineage: await evaluate(request.user, "GetBatchLineage", id) });
    }
  );

  return router;
}

module.exports = {
  createApiRouter,
  privateTermsSchema,
  parseLedgerResult
};
