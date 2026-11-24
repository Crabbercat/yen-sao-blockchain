"use strict";

async function writeAudit(pool, { requestId, userId = null, action, target = null, outcome, details = {} }) {
  await pool.query(
    `INSERT INTO audit_logs (request_id, user_id, action, target, outcome, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [requestId, userId, action, target, outcome, JSON.stringify(details)]
  );
}

module.exports = { writeAudit };
