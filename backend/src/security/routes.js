"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { ApiError } = require("../http/errors");
const { requireAuth, requireRole } = require("../auth/middleware");
const { SecurityTestRunner, TESTS_BY_ID, isUuid } = require("../../../tests/security/runner");

function createSecurityRouter({ dbPool, runner = new SecurityTestRunner() }) {
  const router = express.Router();
  const authenticate = requireAuth(dbPool);
  const securityAdmin = requireRole("security_admin");
  const runLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (request, response) => response.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many security test runs",
        requestId: request.requestId,
        details: []
      }
    })
  });

  router.use((request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.use(authenticate, securityAdmin);

  router.get("/overview", async (_request, response) => {
    response.json(await runner.getOverview());
  });

  router.get("/tests", async (_request, response) => {
    response.json({ tests: runner.getTests() });
  });

  router.post("/tests/:testId/run", (request, _response, next) => {
    const testCase = TESTS_BY_ID.get(request.params.testId);
    if (!testCase) {
      return next(new ApiError(404, "NOT_FOUND", "The requested security test is not allowlisted"));
    }
    const body = request.body === undefined ? {} : request.body;
    const bodyLength = Number(request.get("content-length") || "0");
    const hasUnparsedBody = request.body === undefined
      && (bodyLength > 0 || Boolean(request.get("transfer-encoding")));
    if (
      !body
      || typeof body !== "object"
      || Array.isArray(body)
      || Object.keys(body).length > 0
      || hasUnparsedBody
      || Object.keys(request.query).length > 0
    ) {
      return next(new ApiError(400, "INVALID_ARGUMENT", "Security test runs accept only an allowlisted test ID"));
    }
    request.allowlistedTest = testCase;
    return next();
  }, runLimiter, async (request, response) => {
    const { testId } = request.allowlistedTest;

    try {
      const run = await runner.start(testId, request.socket.localPort, { context: "api" });
      response.status(202).json({ run });
    } catch (error) {
      if (error && error.name === "TestAlreadyRunningError") {
        throw new ApiError(409, "TEST_ALREADY_RUNNING", "Another security test is already running");
      }
      if (error instanceof TypeError) {
        throw new ApiError(503, "LOCAL_TEST_TARGET_UNAVAILABLE", "The local test service is unavailable");
      }
      throw error;
    }
  });

  router.get("/runs", async (_request, response) => {
    response.json({ runs: await runner.listRuns() });
  });

  router.get("/runs/:runId/evidence", async (request, response) => {
    if (!isUuid(request.params.runId)) {
      throw new ApiError(404, "NOT_FOUND", "The requested security evidence was not found");
    }
    const evidence = await runner.getEvidence(request.params.runId);
    if (!evidence) throw new ApiError(404, "NOT_FOUND", "The requested security evidence was not found");
    response.json(evidence);
  });

  router.get("/runs/:runId", async (request, response) => {
    if (!isUuid(request.params.runId)) {
      throw new ApiError(404, "NOT_FOUND", "The requested security test run was not found");
    }
    const run = await runner.getRun(request.params.runId);
    if (!run) throw new ApiError(404, "NOT_FOUND", "The requested security test run was not found");
    response.json({ run });
  });

  return router;
}

module.exports = { createSecurityRouter };
