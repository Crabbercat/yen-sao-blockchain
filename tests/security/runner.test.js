"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { after, test } = require("node:test");
const { SecurityTestRunner, TEST_CASES, localOrigin } = require("./runner");

const scratchDirectory = path.join(__dirname, ".runner-test-reports");
after(async () => {
  await fs.rm(scratchDirectory, { recursive: true, force: true });
});

test("runner builds only numeric loopback origins", () => {
  assert.equal(localOrigin(3000), "http://127.0.0.1:3000");
  assert.throws(() => localOrigin(0), TypeError);
  assert.throws(() => localOrigin("3000"), TypeError);
});

test("catalog defines the complete fixed AT-01 through AT-14 safety scope", async () => {
  const expectedIds = Array.from({ length: 14 }, (_value, index) => `AT-${String(index + 1).padStart(2, "0")}`);
  assert.deepEqual(TEST_CASES.map((testCase) => testCase.testId), expectedIds);
  assert.ok(TEST_CASES.every((testCase) => (
    testCase.objective && testCase.precondition && testCase.expected && testCase.safeExecutionLimit
  )));
  const schema = JSON.parse(await fs.readFile(path.join(__dirname, "result.schema.json"), "utf8"));
  assert.deepEqual(schema.properties.testId.enum, expectedIds);
  assert.deepEqual(schema.properties.status.enum, ["NOT_RUN", "RUNNING", "PASS", "FAIL", "ERROR"]);
});

test("AT-01 cannot probe developer-host ports from the command line", async () => {
  await fs.rm(scratchDirectory, { recursive: true, force: true });
  let fetchCount = 0;
  const runner = new SecurityTestRunner({
    reportDirectory: scratchDirectory,
    env: { SECURITY_LAB_MODE: "true" },
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error("AT-01 must not make HTTP requests");
    }
  });
  const report = await runner.runAndWait("AT-01", 3000);

  assert.equal(report.status, "ERROR");
  assert.match(report.actual, /Host-side network inventory is disabled/);
  assert.equal(fetchCount, 0);
  assert.equal((await runner.getEvidence(report.runId)).requests.length, 0);
});

test("disabled lab mode returns ERROR without network activity", async () => {
  await fs.rm(scratchDirectory, { recursive: true, force: true });
  let fetchCount = 0;
  const runner = new SecurityTestRunner({
    reportDirectory: scratchDirectory,
    env: { SECURITY_LAB_MODE: "false" },
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error("Must not make a network request");
    }
  });
  assert.equal(runner.getTests().every((testCase) => !testCase.runnable), true);
  const report = await runner.runAndWait("AT-02", 3000);

  assert.equal(report.status, "ERROR");
  assert.match(report.actual, /not explicitly enabled/);
  assert.equal(fetchCount, 0);
});

test("missing operator credentials produce an explicit ERROR report without a request", async () => {
  await fs.rm(scratchDirectory, { recursive: true, force: true });
  let fetchCount = 0;
  const runner = new SecurityTestRunner({
    reportDirectory: scratchDirectory,
    env: { SECURITY_LAB_MODE: "true" },
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error("Must not make a network request");
    }
  });
  const report = await runner.runAndWait("AT-03", 3000);

  assert.equal(report.status, "ERROR");
  assert.match(report.actual, /DEMO_USERS_PASSWORD/);
  assert.equal(fetchCount, 0);
  assert.equal(report.target, "http://127.0.0.1:3000");
  assert.equal(report.evidence.length, 1);
  assert.equal((await runner.getEvidence(report.runId)).requests.length, 0);
  assert.match(await fs.readFile(path.join(scratchDirectory, `${report.runId}.md`), "utf8"), /ERROR/);
  assert.equal(JSON.stringify(report).includes("Must not make a network request"), false);
});

test("AT-02 records denied requests without response bodies", async () => {
  await fs.rm(scratchDirectory, { recursive: true, force: true });
  const fetchCalls = [];
  const runner = new SecurityTestRunner({
    reportDirectory: scratchDirectory,
    env: { SECURITY_LAB_MODE: "true" },
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      return new Response(JSON.stringify({
        error: {
          code: "UNAUTHENTICATED",
          message: "no access",
          requestId: "safe",
          details: []
        }
      }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  const report = await runner.runAndWait("AT-02", 3000);

  assert.equal(report.status, "PASS");
  assert.equal(fetchCalls.length, 3);
  assert.ok(fetchCalls.every(({ url }) => url.startsWith("http://127.0.0.1:3000/")));
  assert.equal(JSON.stringify(report).includes("no access"), false);
  assert.equal((await runner.getEvidence(report.runId)).requests.length, 3);
});

test("AT-10 verifies readiness from the TLS-configured Fabric Gateway path", async () => {
  await fs.rm(scratchDirectory, { recursive: true, force: true });
  let requestedUrl;
  const runner = new SecurityTestRunner({
    reportDirectory: scratchDirectory,
    env: { SECURITY_LAB_MODE: "true" },
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({
        status: "ready",
        checks: { database: "ready", fabric: "ready" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  const report = await runner.runAndWait("AT-10", 3000);

  assert.equal(report.status, "PASS");
  assert.equal(requestedUrl, "http://127.0.0.1:3000/ready");
  assert.match(report.summary, /TLS roots/);
});

test("failed controls include a structured finding without recording response data", async () => {
  await fs.rm(scratchDirectory, { recursive: true, force: true });
  const runner = new SecurityTestRunner({
    reportDirectory: scratchDirectory,
    env: { SECURITY_LAB_MODE: "true" },
    fetchImpl: async () => new Response(JSON.stringify({ accessToken: "not-for-report" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });
  const report = await runner.runAndWait("AT-02", 3000);

  assert.equal(report.status, "FAIL");
  assert.equal(report.finding.severity, "High");
  assert.ok(report.finding.impact);
  assert.ok(report.finding.remediation);
  assert.equal(report.finding.retestResult, "NOT_RETESTED");
  assert.equal(JSON.stringify(report).includes("not-for-report"), false);
});

test("AT-14 is bounded and blocks concurrent security runs", async () => {
  await fs.rm(scratchDirectory, { recursive: true, force: true });
  const runner = new SecurityTestRunner({
    reportDirectory: scratchDirectory,
    env: { SECURITY_LAB_MODE: "true" }
  });
  const started = await runner.start("AT-14", 3000);
  await assert.rejects(
    runner.start("AT-02", 3000),
    (error) => error.name === "TestAlreadyRunningError"
  );
  const report = await runner.waitFor(started.runId);

  assert.equal(report.status, "PASS");
  assert.match(report.actual, /401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429/);
  assert.match(report.notes.join(" "), /ephemeral app/);
});
