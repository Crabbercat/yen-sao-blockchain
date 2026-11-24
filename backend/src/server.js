const { Pool } = require("pg");
const { createApp } = require("./app");
const { IdentityResolver } = require("./fabric/identity-resolver");
const { FabricGatewayService } = require("./fabric/gateway-service");

const port = Number(process.env.PORT || 3000);
const dbPool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "yen_sao",
  user: process.env.DB_USER || "yen_sao_app",
  password: process.env.DB_PASSWORD
});

dbPool.on("error", (error) => {
  const code = error && typeof error.code === "string" ? error.code : "UNKNOWN";
  console.error(JSON.stringify({ event: "database_pool_error", code }));
});

const identityResolver = new IdentityResolver(process.env);
const fabricGateway = new FabricGatewayService({ identityResolver });
const app = createApp({ dbPool, fabricGateway });
const server = app.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "server_started", port }));
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close((serverError) => {
    if (serverError) {
      console.error(JSON.stringify({
        event: "server_shutdown_failed",
        code: serverError.code || "UNKNOWN"
      }));
      process.exitCode = 1;
    }

    dbPool.end().catch((error) => {
      const code = error && typeof error.code === "string" ? error.code : "UNKNOWN";
      console.error(JSON.stringify({ event: "database_shutdown_failed", code }));
      process.exitCode = 1;
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
