"use strict";

const { Pool } = require("pg");

function createPool(env = process.env) {
  return new Pool({
    host: env.DB_HOST || "localhost",
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME || "yen_sao",
    user: env.DB_USER || "yen_sao_app",
    password: env.DB_PASSWORD
  });
}

module.exports = { createPool };
