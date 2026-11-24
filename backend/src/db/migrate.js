"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createPool } = require("./pool");

async function runMigrations(pool, migrationsPath = path.resolve(__dirname, "../../../database/migrations")) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version varchar(255) PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(migrationsPath))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const sql = await fs.readFile(path.join(migrationsPath, filename), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const existing = await pool.query(
      "SELECT checksum FROM schema_migrations WHERE version = $1",
      [filename]
    );

    if (existing.rowCount > 0) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Applied migration ${filename} has changed`);
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
        [filename, checksum]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  const pool = createPool();
  runMigrations(pool)
    .then(() => console.log(JSON.stringify({ event: "database_migrations_complete" })))
    .catch((error) => {
      console.error(JSON.stringify({
        event: "database_migrations_failed",
        message: error.message,
        code: error.code || "UNKNOWN"
      }));
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { runMigrations };
