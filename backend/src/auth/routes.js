"use strict";

const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { ApiError, validate } = require("../http/errors");
const { writeAudit } = require("../http/audit");
const { hashToken, requireAuth } = require("./middleware");

const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200)
}).strict();
const SESSION_LIFETIME_MS = 4 * 60 * 60 * 1000;

function createAuthRouter({ dbPool, logger = console }) {
  const router = express.Router();
  const authenticate = requireAuth(dbPool);
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (request, response) => response.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many login attempts",
        requestId: request.requestId,
        details: []
      }
    })
  });

  router.post("/login", loginLimiter, async (request, response) => {
    const body = validate(loginSchema, request.body);
    const result = await dbPool.query(
      `SELECT id, username, password_hash, display_name, organization_msp, role, fabric_identity, status
       FROM users WHERE username = $1`,
      [body.username]
    );
    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(body.password, user?.password_hash || "");
    if (!user || user.status !== "active" || !passwordMatches) {
      await writeAudit(dbPool, {
        requestId: request.requestId,
        action: "auth.login",
        target: body.username,
        outcome: "failure"
      });
      throw new ApiError(401, "INVALID_CREDENTIALS", "Username or password is incorrect");
    }

    const accessToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await dbPool.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
      [hashToken(accessToken), user.id, expiresAt]
    );
    await writeAudit(dbPool, {
      requestId: request.requestId,
      userId: user.id,
      action: "auth.login",
      outcome: "success"
    });

    logger.info(JSON.stringify({
      event: "auth_login",
      requestId: request.requestId,
      userId: user.id,
      role: user.role
    }));
    response.status(200).json({
      accessToken,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        organizationMsp: user.organization_msp,
        role: user.role
      }
    });
  });

  router.post("/logout", authenticate, async (request, response) => {
    const authorization = request.get("authorization");
    const token = authorization.slice("Bearer ".length);
    await dbPool.query(
      "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
      [hashToken(token)]
    );
    await writeAudit(dbPool, {
      requestId: request.requestId,
      userId: request.user.id,
      action: "auth.logout",
      outcome: "success"
    });
    response.status(204).end();
  });

  router.get("/me", authenticate, (request, response) => {
    response.json({
      user: {
        id: request.user.id,
        username: request.user.username,
        displayName: request.user.display_name,
        organizationMsp: request.user.organization_msp,
        role: request.user.role
      }
    });
  });

  return router;
}

module.exports = { SESSION_LIFETIME_MS, createAuthRouter, loginSchema };
