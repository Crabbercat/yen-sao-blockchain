"use strict";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApp } = require("../src/app");
const { hashToken } = require("../src/auth/middleware");

const securityToken = "d".repeat(64);
const harvestToken = "e".repeat(64);
const securityUser = {
  id: "00000000-0000-4000-8000-000000000010",
  username: "security.admin",
  display_name: "Security Administrator",
  organization_msp: null,
  role: "security_admin",
  fabric_identity: null
};
const harvestUser = {
  id: "00000000-0000-4000-8000-000000000011",
  username: "harvest.operator",
  display_name: "Harvest Operator",
  organization_msp: "OrgHarvestMSP",
  role: "harvest_operator",
  fabric_identity: "harvest.operator"
};
const runId = "00000000-0000-4000-8000-000000000012";
const definitions = [{
  testId: "AT-02",
  name: "Unauthenticated API access",
  runnable: true
}];

let server;
let baseUrl;
let starts;

before(async () => {
  starts = [];
  const dbPool = {
    query: async (sql, parameters = []) => {
      if (!sql.includes("FROM sessions")) return { rows: [], rowCount: 0 };
      const user = parameters[0] === hashToken(securityToken)
        ? securityUser
        : parameters[0] === hashToken(harvestToken)
          ? harvestUser
          : null;
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }
  };
  const securityTestRunner = {
    getTests: () => definitions,
    getOverview: async () => ({ tests: definitions, latestRuns: [] }),
    listRuns: async () => [],
    start: async (testId, port) => {
      starts.push({ testId, port });
      return { runId, testId, status: "RUNNING", startedAt: "2026-01-01T00:00:00.000Z" };
    },
    getRun: async (id) => id === runId ? { runId, testId: "AT-02", status: "PASS" } : null,
    getEvidence: async (id) => id === runId ? { runId, requests: [] } : null
  };
  server = createApp({
    dbPool,
    fabricGateway: { checkReady: async () => undefined },
    securityTestRunner
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("security dashboard endpoints require authentication and the security_admin role", async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/v1/security/tests`);
  assert.equal(unauthenticated.status, 401);

  const forbidden = await fetch(`${baseUrl}/api/v1/security/tests`, {
    headers: { Authorization: `Bearer ${harvestToken}` }
  });
  assert.equal(forbidden.status, 403);

  const allowed = await fetch(`${baseUrl}/api/v1/security/tests`, {
    headers: { Authorization: `Bearer ${securityToken}` }
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await allowed.json(), { tests: definitions });
});

test("served dashboard assets contain the allowlisted security view", async () => {
  const [script, stylesheet, page] = await Promise.all([
    fetch(`${baseUrl}/app.js`),
    fetch(`${baseUrl}/styles.css`),
    fetch(baseUrl)
  ]);
  assert.equal(script.status, 200);
  assert.equal(stylesheet.status, 200);
  assert.equal(page.status, 200);
  const [scriptText, stylesheetText, pageText] = await Promise.all([
    script.text(),
    stylesheet.text(),
    page.text()
  ]);
  assert.match(pageText, /data-view="security"/);
  assert.match(scriptText, /renderSecurityComparisons/);
  assert.match(scriptText, /\/api\/v1\/security\/overview/);
  assert.match(stylesheetText, /\.security-test-grid/);
});

test("security run accepts only an allowlisted ID and no caller-supplied parameters", async () => {
  const auth = { Authorization: `Bearer ${securityToken}` };
  const unknown = await fetch(`${baseUrl}/api/v1/security/tests/AT-99/run`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(unknown.status, 404);

  const targetOverride = await fetch(`${baseUrl}/api/v1/security/tests/AT-02/run?target=http://example.com`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(targetOverride.status, 400);

  const extraInput = await fetch(`${baseUrl}/api/v1/security/tests/AT-02/run`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ command: "not-allowed" })
  });
  assert.equal(extraInput.status, 400);

  const unparsedInput = await fetch(`${baseUrl}/api/v1/security/tests/AT-02/run`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "text/plain" },
    body: "target=http://example.com"
  });
  assert.equal(unparsedInput.status, 400);
  assert.equal(starts.length, 0);

  const accepted = await fetch(`${baseUrl}/api/v1/security/tests/AT-02/run`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(accepted.status, 202);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].testId, "AT-02");
  assert.equal(starts[0].port, server.address().port);
});

test("security run detail and evidence links do not accept filesystem paths", async () => {
  const auth = { Authorization: `Bearer ${securityToken}` };
  const run = await fetch(`${baseUrl}/api/v1/security/runs/${runId}`, { headers: auth });
  assert.equal(run.status, 200);
  assert.equal((await run.json()).run.status, "PASS");

  const evidence = await fetch(`${baseUrl}/api/v1/security/runs/${runId}/evidence`, { headers: auth });
  assert.equal(evidence.status, 200);
  assert.deepEqual(await evidence.json(), { runId, requests: [] });

  const traversal = await fetch(`${baseUrl}/api/v1/security/runs/..%2F..%2F.env`, { headers: auth });
  assert.equal(traversal.status, 404);
});
