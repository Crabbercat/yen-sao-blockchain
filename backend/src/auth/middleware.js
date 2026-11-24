"use strict";

const crypto = require("node:crypto");
const { ApiError } = require("../http/errors");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function requireAuth(dbPool) {
  return async (request, _response, next) => {
    const authorization = request.get("authorization") || "";
    const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(authorization);
    if (!match) return next(new ApiError(401, "UNAUTHENTICATED", "A valid bearer token is required"));

    const result = await dbPool.query(
      `SELECT users.id, users.username, users.display_name, users.organization_msp,
              users.role, users.fabric_identity
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1
         AND sessions.revoked_at IS NULL
         AND sessions.expires_at > now()
         AND users.status = 'active'`,
      [hashToken(match[1])]
    );
    if (result.rowCount !== 1) {
      return next(new ApiError(401, "UNAUTHENTICATED", "The bearer token is invalid or expired"));
    }

    request.user = result.rows[0];
    return next();
  };
}

function requireRole(...roles) {
  return (request, _response, next) => {
    if (!request.user || !roles.includes(request.user.role)) {
      return next(new ApiError(403, "FORBIDDEN", "The current role is not allowed to access this resource"));
    }
    return next();
  };
}

module.exports = { hashToken, requireAuth, requireRole };
