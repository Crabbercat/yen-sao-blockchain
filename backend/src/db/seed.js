"use strict";

const bcrypt = require("bcryptjs");
const { createPool } = require("./pool");

const DEMO_USERS = [
  ["harvest.operator", "Harvest Operator", "OrgHarvestMSP", "harvest_operator", "harvest.operator"],
  ["processing.operator", "Processing Operator", "OrgProcessingMSP", "processing_operator", "processing.operator"],
  ["quality.inspector", "Quality Inspector", "OrgProcessingMSP", "quality_inspector", "quality.inspector"],
  ["distributor.operator", "Distributor", "OrgDistributionMSP", "distributor", "distributor.operator"],
  ["auditor", "Demo Auditor", null, "auditor", null],
  ["consumer", "Demo Consumer", null, "consumer", null],
  ["security.admin", "Security Administrator", null, "security_admin", null],
  ["system.admin", "System Administrator", null, "system_admin", null]
];

async function seedDemoUsers(pool, env = process.env) {
  if (env.NODE_ENV === "production") {
    throw new Error("Demo user seeding is disabled in production");
  }
  if (!env.DEMO_USERS_PASSWORD || env.DEMO_USERS_PASSWORD.length < 12) {
    throw new Error("DEMO_USERS_PASSWORD must contain at least 12 characters");
  }

  for (const [username, displayName, mspId, role, fabricIdentity] of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(env.DEMO_USERS_PASSWORD, 12);
    await pool.query(
      `INSERT INTO users (username, password_hash, display_name, organization_msp, role, fabric_identity)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         organization_msp = EXCLUDED.organization_msp,
         role = EXCLUDED.role,
         fabric_identity = EXCLUDED.fabric_identity,
         updated_at = now()`,
      [username, passwordHash, displayName, mspId, role, fabricIdentity]
    );
  }
}

if (require.main === module) {
  const pool = createPool();
  seedDemoUsers(pool)
    .then(() => console.log(JSON.stringify({ event: "demo_users_seeded", count: DEMO_USERS.length })))
    .catch((error) => {
      console.error(JSON.stringify({
        event: "demo_user_seed_failed",
        message: error.message,
        code: error.code || "UNKNOWN"
      }));
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { DEMO_USERS, seedDemoUsers };
