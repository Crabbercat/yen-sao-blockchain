const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApp } = require("../src/app");

let server;
let baseUrl;

before(async () => {
  const dbPool = { query: async () => ({ rows: [{ "?column?": 1 }] }) };
  const fabricGateway = { checkReady: async () => undefined };
  server = createApp({ dbPool, fabricGateway }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("GET /health reports liveness", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("GET /ready verifies PostgreSQL and Fabric connectivity", async () => {
  const response = await fetch(`${baseUrl}/ready`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ready",
    checks: { database: "ready", fabric: "ready" }
  });
});

test("GET / serves the static frontend", async () => {
  const response = await fetch(baseUrl);
  const page = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(page, /Yến Sào Cù Lao Chàm/);
});

test("GET /trace/:batchId serves the public trace frontend", async () => {
  const response = await fetch(`${baseUrl}/trace/YEN-TEST-01`);

  assert.equal(response.status, 200);
  assert.match(await response.text(), /id="public-trace-panel"/);
});

test("GET /ready reports database failures without exposing details", async (t) => {
  const loggedErrors = [];
  const dbPool = {
    query: async () => {
      throw Object.assign(new Error("connection details must not be returned"), {
        code: "ECONNREFUSED"
      });
    }
  };
  const fabricGateway = { checkReady: async () => undefined };
  const app = createApp({
    dbPool,
    fabricGateway,
    logger: { error: (message) => loggedErrors.push(message) }
  });
  const failureServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => failureServer.once("listening", resolve));
  t.after(() => new Promise((resolve, reject) => {
    failureServer.close((error) => error ? reject(error) : resolve());
  }));

  const response = await fetch(`http://127.0.0.1:${failureServer.address().port}/ready`);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.deepEqual(body, {
    status: "not_ready",
    checks: { database: "unavailable", fabric: "ready" }
  });
  assert.equal(JSON.stringify(body).includes("connection details"), false);
  assert.deepEqual(loggedErrors, [
    JSON.stringify({
      event: "readiness_failed",
      check: "database",
      code: "ECONNREFUSED"
    })
  ]);
});
