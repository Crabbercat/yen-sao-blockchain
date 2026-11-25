"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { ApiError, errorHandler } = require("./http/errors");
const { createAuthRouter } = require("./auth/routes");
const { createApiRouter } = require("./routes/api-v1");
const { createDocumentRouter } = require("./documents/routes");
const { createSecurityRouter } = require("./security/routes");
const { SecurityTestRunner } = require("../../tests/security/runner");

const PUBLIC_READER = Object.freeze({
  username: "public-reader",
  organization_msp: "OrgHarvestMSP",
  role: "harvest_operator",
  fabric_identity: "harvest.operator"
});

function createApp({
  dbPool,
  fabricGateway,
  logger = console,
  fileStoragePath = process.env.FILE_STORAGE_PATH || path.resolve(__dirname, "../../storage/uploads"),
  corsOrigins = process.env.CORS_ORIGINS || "",
  publicBaseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000",
  securityTestRunner = new SecurityTestRunner()
} = {}) {
  if (!dbPool || typeof dbPool.query !== "function") {
    throw new TypeError("A PostgreSQL pool is required");
  }
  if (!fabricGateway || typeof fabricGateway.checkReady !== "function") {
    throw new TypeError("A Fabric Gateway service is required");
  }

  const allowedOrigins = new Set(corsOrigins.split(",").map((origin) => origin.trim()).filter(Boolean));
  const parsedPublicBaseUrl = new URL(publicBaseUrl);
  if (
    !["http:", "https:"].includes(parsedPublicBaseUrl.protocol)
    || parsedPublicBaseUrl.username
    || parsedPublicBaseUrl.password
    || parsedPublicBaseUrl.pathname !== "/"
    || parsedPublicBaseUrl.search
    || parsedPublicBaseUrl.hash
  ) {
    throw new TypeError("PUBLIC_BASE_URL must be an HTTP(S) origin without credentials or a path");
  }
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use((request, response, next) => {
    request.requestId = crypto.randomUUID();
    response.set("X-Request-Id", request.requestId);

    const origin = request.get("origin");
    if (origin && allowedOrigins.has(origin)) {
      response.set("Access-Control-Allow-Origin", origin);
      response.set("Vary", "Origin");
      response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      response.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (request.method === "OPTIONS") return response.status(204).end();
    return next();
  });
  app.use(express.json({ limit: "1mb", strict: true }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/ready", async (_request, response) => {
    const checks = { database: "ready", fabric: "ready" };
    const results = await Promise.allSettled([
      dbPool.query("SELECT 1"),
      fabricGateway.checkReady()
    ]);

    if (results[0].status === "rejected") {
      checks.database = "unavailable";
      logger.error(JSON.stringify({
        event: "readiness_failed",
        check: "database",
        code: results[0].reason?.code || "UNKNOWN"
      }));
    }
    if (results[1].status === "rejected") {
      checks.fabric = "unavailable";
      logger.error(JSON.stringify({
        event: "readiness_failed",
        check: "fabric",
        code: results[1].reason?.code || "UNKNOWN"
      }));
    }

    const isReady = Object.values(checks).every((status) => status === "ready");
    response.status(isReady ? 200 : 503).json({
      status: isReady ? "ready" : "not_ready",
      checks
    });
  });

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (request, response) => response.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many API requests. Please try again later.",
        requestId: request.requestId,
        details: []
      }
    })
  });
  app.use("/api/v1", apiLimiter);
  app.use("/api/v1/auth", createAuthRouter({ dbPool, logger }));
  app.use("/api/v1/security", createSecurityRouter({
    dbPool,
    runner: securityTestRunner
  }));
  app.use("/api/v1", createApiRouter({
    dbPool,
    fabricGateway,
    logger,
    publicReader: PUBLIC_READER,
    publicBaseUrl: parsedPublicBaseUrl.origin
  }));
  app.use("/api/v1/documents", createDocumentRouter({
    dbPool,
    fabricGateway,
    fileStoragePath,
    publicReader: PUBLIC_READER,
    logger
  }));

  const frontendPath = path.resolve(__dirname, "../../frontend/public");
  app.get("/trace/:batchId", (_request, response) => {
    response.sendFile(path.join(frontendPath, "index.html"));
  });
  app.use(express.static(frontendPath));
  app.use((_request, _response, next) => {
    next(new ApiError(404, "NOT_FOUND", "The requested resource was not found"));
  });
  app.use(errorHandler(logger));
  return app;
}

module.exports = { PUBLIC_READER, createApp };
