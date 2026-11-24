"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { TEST_CASES, TESTS_BY_ID } = require("./test-cases");

const REPORT_DIRECTORY = path.resolve(__dirname, "..", "reports", "security");
const REPORT_LIMIT = 50;
const RESPONSE_LIMIT = 64 * 1024;
const REQUEST_TIMEOUT_MS = 4000;
const PORTS_TO_CHECK = Object.freeze([5432, 7050, 7051, 7054, 9051]);
const SECRET_FIELD_NAMES = new Set(["commercialPrice", "contractReference", "supplierNotes", "privateTerms"]);
const TEST_BATCH = "YEN-2026-0001-A";

class PrerequisiteError extends Error {
  constructor(message) {
    super(message);
    this.name = "PrerequisiteError";
  }
}

class TestAlreadyRunningError extends Error {
  constructor() {
    super("A security test run is already in progress");
    this.name = "TestAlreadyRunningError";
  }
}

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function localOrigin(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("The security runner requires a valid local service port");
  }
  return `http://127.0.0.1:${port}`;
}

function sanitizeCode(value) {
  return typeof value === "string" && /^[A-Z0-9_]{1,60}$/.test(value) ? value : "INVALID_RESPONSE";
}

async function readLimitedBody(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RESPONSE_LIMIT) {
      await reader.cancel();
      throw new PrerequisiteError("The local service response exceeded the 64 KiB safety limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function responseDetails(response) {
  const text = await readLimitedBody(response);
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  return {
    status: response.status,
    code: sanitizeCode(payload && payload.error && payload.error.code),
    requestId: response.headers.get("x-request-id") || undefined,
    payload
  };
}

function evidenceEntry(method, route, response, assertion) {
  return {
    method,
    path: route,
    status: response.status,
    code: response.code,
    requestId: response.requestId,
    assertion
  };
}

function result(status, actual, summary, requests = [], notes = []) {
  return {
    status,
    actual,
    summary,
    evidence: { requests },
    notes
  };
}

async function connectToLoopbackPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function hasPrivateField(value) {
  if (Array.isArray(value)) return value.some(hasPrivateField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => (
    SECRET_FIELD_NAMES.has(key) || hasPrivateField(item)
  ));
}

function testTarget(testId, port) {
  return testId === "AT-14"
    ? "isolated in-process loopback authentication app"
    : localOrigin(port);
}

async function executeTest(testId, { targetPort, env, fetchImpl, context }) {
  if (env.SECURITY_LAB_MODE !== "true") {
    return result("ERROR", "SECURITY_LAB_MODE is not explicitly enabled.",
      "Test execution is disabled outside an explicitly enabled local security lab.",
      [], ["Set SECURITY_LAB_MODE=true only for the isolated local lab; the runner never changes this setting."]);
  }
  const origin = localOrigin(targetPort);
  const requests = [];
  const notes = [];

  async function request(route, options = {}) {
    const response = await fetchImpl(`${origin}${route}`, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const details = await responseDetails(response);
    return { ...details, response };
  }

  async function login(username) {
    const password = env.DEMO_USERS_PASSWORD;
    if (!password) throw new PrerequisiteError("DEMO_USERS_PASSWORD is not configured in the backend environment");
    const response = await request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (response.status !== 200 || !response.payload || typeof response.payload.accessToken !== "string") {
      const code = response.status === 401 ? "DEMO_CREDENTIALS_INVALID" : response.code;
      throw new PrerequisiteError(`The seeded ${username} account could not authenticate (${code})`);
    }
    return response.payload.accessToken;
  }

  try {
    switch (testId) {
      case "AT-01": {
        if (context !== "api") {
          return result("ERROR", "Host-side network inventory is disabled.",
            "Run AT-01 from the authenticated dashboard so checks remain inside the backend container namespace.",
            [], ["The command-line runner never probes ports on the developer host."]);
        }
        const ports = [...new Set([targetPort, ...PORTS_TO_CHECK])];
        const checked = await Promise.all(ports.map(async (port) => ({
          port,
          open: await connectToLoopbackPort(port)
        })));
        const unexpected = checked.filter(({ port, open }) => open && port !== targetPort);
        const openPorts = checked.filter((entry) => entry.open).map((entry) => entry.port);
        const status = unexpected.length === 0 && openPorts.includes(targetPort) ? "PASS" : "FAIL";
        return result(
          status,
          `Loopback ports checked: ${checked.length}; open: ${openPorts.join(", ") || "none"}`,
          status === "PASS"
            ? "Only the backend service port was reachable in its local container namespace."
            : "An unexpected fixed service port was reachable, or the backend listener was unavailable.",
          [{ method: "TCP", path: "127.0.0.1 (fixed lab port list)", status: 0, code: "LOCAL_ONLY", assertion: { checked, allowedBackendPort: targetPort } }],
          ["This bounded check does not inventory host, Fabric bridge, or LAN exposure."]
        );
      }
      case "AT-02": {
        const results = [];
        for (const route of ["/api/v1/batches", "/api/v1/auth/me"]) {
          const response = await request(route);
          const denied = response.status === 401;
          const leaksDetails = response.payload && (
            Object.hasOwn(response.payload, "batches")
            || Object.hasOwn(response.payload, "user")
            || Object.hasOwn(response.payload, "accessToken")
          );
          requests.push(evidenceEntry("GET", route, response, denied && !leaksDetails));
          results.push(denied && !leaksDetails);
        }
        const invalidTokenRoute = "/api/v1/batches";
        const invalid = await request(invalidTokenRoute, {
          headers: { Authorization: "Bearer invalid-security-test-token" }
        });
        const invalidDenied = invalid.status === 401;
        requests.push(evidenceEntry("GET", invalidTokenRoute, invalid, invalidDenied));
        results.push(invalidDenied);
        const status = results.every(Boolean) ? "PASS" : "FAIL";
        return result(status, "Protected requests were evaluated without returning protected records.", status === "PASS"
          ? "Missing and invalid credentials were denied."
          : "At least one unauthenticated request was not safely denied.", requests);
      }
      case "AT-03": {
        const token = await login("harvest.operator");
        const route = "/api/v1/batches/SECURITY-AT03-DENIED/derived";
        const response = await request(route, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: "{}"
        });
        const passed = response.status === 403 && response.code === "FORBIDDEN";
        requests.push(evidenceEntry("POST", route, response, passed));
        return result(passed ? "PASS" : "FAIL", `HTTP ${response.status} (${response.code})`,
          passed ? "A harvest role was denied before request validation or Fabric submission."
            : "A harvest role was not denied from a processing-only endpoint.",
          requests, ["The denied request does not submit a Fabric transaction."]);
      }
      case "AT-04": {
        const token = await login("harvest.operator");
        const meRoute = "/api/v1/auth/me";
        const me = await request(meRoute, { headers: { Authorization: `Bearer ${token}` } });
        const correctIdentity = me.status === 200
          && me.payload?.user?.role === "harvest_operator"
          && me.payload?.user?.organizationMsp === "OrgHarvestMSP";
        requests.push(evidenceEntry("GET", meRoute, me, correctIdentity));

        const route = "/api/v1/batches/harvest";
        const response = await request(route, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            batchId: "SECURITY-AT04-NOT-SUBMITTED",
            eventId: "SECURITY-AT04-NOT-SUBMITTED",
            species: "Swiftlet",
            harvestLocation: "Local security test",
            harvestedAt: "2026-01-01T00:00:00.000Z",
            quantity: 1,
            unit: "kg",
            organization: "OrgProcessingMSP",
            role: "system_admin"
          })
        });
        const forgedFieldsRejected = response.status === 400 && response.code === "INVALID_ARGUMENT";
        requests.push(evidenceEntry("POST", route, response, forgedFieldsRejected));
        const passed = correctIdentity && forgedFieldsRejected;
        return result(passed ? "PASS" : "FAIL", `Authenticated identity matched: ${correctIdentity}; forged fields rejected: ${forgedFieldsRejected}.`,
          passed ? "Forged role/organization fields were rejected before Fabric submission."
            : "Authenticated account mapping or strict payload validation did not behave as expected.",
          requests, ["This API-boundary check does not claim to replace a direct chaincode identity test."]);
      }
      case "AT-05": {
        const token = await login("distributor.operator");
        const route = "/api/v1/shipments/SECURITY-AT05-MISSING/accept";
        const response = await request(route, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ eventId: "SECURITY-AT05-MISSING" })
        });
        requests.push(evidenceEntry("POST", route, response, response.status === 404 || response.status === 409));
        if (response.status === 401 || response.status === 403 || response.status >= 500) {
          throw new PrerequisiteError(`Fabric-backed rejection could not be verified (${response.status} ${response.code})`);
        }
        const passed = response.status === 404 || response.status === 409;
        return result(passed ? "PASS" : "FAIL", `HTTP ${response.status} (${response.code})`,
          passed ? "Fabric rejected acceptance of the fixed nonexistent shipment."
            : "The nonexistent shipment request was not rejected as an invalid state.",
          requests, ["The test uses a nonexistent shipment ID and does not create or alter ledger state."]);
      }
      case "AT-06": {
        const token = await login("harvest.operator");
        const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase();
        const batchId = `SECURITY-AT06-${suffix}`;
        const eventId = `EVENT-AT06-${suffix}`;
        const route = "/api/v1/batches/harvest";
        const options = {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            batchId,
            eventId,
            species: "Swiftlet",
            harvestLocation: "Local security test",
            harvestedAt: new Date().toISOString(),
            quantity: 0.001,
            unit: "kg"
          })
        };
        const first = await request(route, options);
        requests.push(evidenceEntry("POST", route, first, first.status === 201));
        if (first.status !== 201) {
          if (first.status === 401 || first.status === 403 || first.status >= 500) {
            throw new PrerequisiteError(`A local Fabric write was unavailable (${first.status} ${first.code})`);
          }
          return result("FAIL", `Initial request returned HTTP ${first.status} (${first.code}).`,
            "The isolated test event could not be created.", requests);
        }

        const replay = await request(route, options);
        const replayAccepted = replay.status === 201 || replay.status === 409;
        requests.push(evidenceEntry("POST", route, replay, replayAccepted));
        const historyRoute = `/api/v1/batches/${encodeURIComponent(batchId)}/history`;
        const historyResponse = await request(historyRoute, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const events = historyResponse.payload?.history;
        const eventCount = Array.isArray(events)
          ? events.filter((event) => event.eventId === eventId).length
          : -1;
        const oneEvent = historyResponse.status === 200 && eventCount === 1;
        requests.push(evidenceEntry("GET", historyRoute, historyResponse, oneEvent));
        const passed = replayAccepted && oneEvent;
        return result(passed ? "PASS" : "FAIL",
          `Replay HTTP ${replay.status}; matching history event count: ${eventCount}.`,
          passed ? "The repeated event did not create a duplicate history event."
            : "The repeated event could not be proven idempotent.",
          requests, ["One uniquely prefixed test batch remains on the local append-only ledger for auditability."]);
      }
      case "AT-07":
        return result("ERROR", "No Fabric endorsement proposal was submitted.",
          "A safe real-network endorsement fixture is not configured.",
          [], [
            "The existing blockchain/network/scripts/test-chaincode.sh includes real-peer endorsement checks; run it only from the operator's isolated Fabric workspace.",
            "The API runner does not launch host shell/Docker commands or submit its fixed test transactions.",
            "No mocked endorsement result is reported as a pass."
          ]);
      case "AT-08": {
        const token = await login("distributor.operator");
        const privateRoute = "/api/v1/batches/SECURITY-AT08-CHECK/private-terms";
        const privateResponse = await request(privateRoute, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const denied = privateResponse.status === 403 && privateResponse.code === "FORBIDDEN";
        requests.push(evidenceEntry("GET", privateRoute, privateResponse, denied));
        const traceRoute = `/api/v1/trace/${encodeURIComponent(TEST_BATCH)}`;
        const traceResponse = await request(traceRoute);
        if (traceResponse.status === 404 || traceResponse.status >= 500) {
          throw new PrerequisiteError(`The fixed SPEC trace fixture ${TEST_BATCH} is unavailable (${traceResponse.status} ${traceResponse.code})`);
        }
        const privateFieldsAbsent = traceResponse.status === 200 && !hasPrivateField(traceResponse.payload);
        requests.push(evidenceEntry("GET", traceRoute, traceResponse, privateFieldsAbsent));
        const passed = denied && privateFieldsAbsent;
        return result(passed ? "PASS" : "FAIL",
          `Non-member private-terms denied: ${denied}; public trace private fields absent: ${privateFieldsAbsent}.`,
          passed ? "Private terms were denied and the public trace contained no private-term fields."
            : "Private data access or public projection did not meet expectations.",
          requests, ["This verifies the API boundary and public projection; it does not prove a direct non-member PDC query."]);
      }
      case "AT-09": {
        const token = await login("harvest.operator");
        const historyRoute = `/api/v1/batches/${encodeURIComponent(TEST_BATCH)}/history`;
        const before = await request(historyRoute, { headers: { Authorization: `Bearer ${token}` } });
        if (before.status !== 200 || !Array.isArray(before.payload?.history)) {
          throw new PrerequisiteError(`The fixed SPEC history fixture ${TEST_BATCH} is unavailable (${before.status} ${before.code})`);
        }
        requests.push(evidenceEntry("GET", historyRoute, before, true));

        const updateRoute = `/api/v1/batches/${encodeURIComponent(TEST_BATCH)}`;
        const update = await request(updateRoute, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ status: "REWRITTEN" })
        });
        const rejected = update.status === 404;
        requests.push(evidenceEntry("PUT", updateRoute, update, rejected));
        const after = await request(historyRoute, { headers: { Authorization: `Bearer ${token}` } });
        const unchanged = after.status === 200
          && JSON.stringify(before.payload.history) === JSON.stringify(after.payload?.history);
        requests.push(evidenceEntry("GET", historyRoute, after, unchanged));
        const passed = rejected && unchanged;
        return result(passed ? "PASS" : "FAIL",
          `Update route rejected: ${rejected}; history unchanged: ${unchanged}.`,
          passed ? "The application exposed no history-rewrite route and the ledger history remained unchanged."
            : "The update attempt was not rejected or the history changed.",
          requests, ["No direct ledger, peer filesystem, or Docker volume tampering was attempted."]);
      }
      case "AT-10": {
        const route = "/ready";
        const response = await request(route);
        const fabricReady = response.payload?.checks?.fabric === "ready";
        const fabricUnavailable = response.payload?.checks?.fabric === "unavailable";
        requests.push(evidenceEntry("GET", route, response, fabricReady));
        if (!fabricReady && !fabricUnavailable) {
          throw new PrerequisiteError(`Fabric TLS readiness could not be determined (${response.status} ${response.code})`);
        }
        return result(fabricReady ? "PASS" : "ERROR",
          `Fabric readiness: ${response.payload.checks.fabric}.`,
          fabricReady
            ? "Fabric Gateway connected to all configured peers using TLS roots."
            : "Fabric peers were unavailable; TLS could not be verified.",
          requests, ["The readiness check uses trusted gRPC TLS roots; no packet capture or unrelated traffic was inspected."]);
      }
      case "AT-11":
        return result("ERROR", "No scanner was launched.",
          "Container scanning is intentionally unavailable through the backend API.",
          [], ["Docker socket operations are prohibited. Run only a separately approved offline scan against a fixed local image and record its digest."]);
      case "AT-12":
        return result("ERROR", "No workload was generated.",
          "A bounded workload profile has not been approved for this lab.",
          [], ["No load generator is exposed; do not supply user-defined workload sizes or targets."]);
      case "AT-13": {
        const token = await login("harvest.operator");
        const form = new FormData();
        form.append("batchId", "SECURITY-AT13-NOT-STORED");
        form.append("file", new Blob(["bounded"], { type: "text/plain" }), "../../SECURITY-AT13.txt");
        const route = "/api/v1/documents";
        const response = await request(route, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form
        });
        const rejected = response.status === 400
          && ["UNSUPPORTED_FILE_TYPE", "UPLOAD_ERROR"].includes(response.code);
        requests.push(evidenceEntry("POST", route, response, rejected));
        return result(rejected ? "PASS" : "FAIL", `HTTP ${response.status} (${response.code})`,
          rejected ? "The invalid text/traversal-style upload was rejected before file storage."
            : "The invalid upload was not rejected as expected.",
          requests, ["The body is seven bytes and uses in-memory multipart data; no file is written."]);
      }
      case "AT-14": {
        const { createApp } = require("../../backend/src/app");
        const dbPool = {
          query: async (sql) => {
            if (sql.includes("FROM users")) return { rows: [], rowCount: 0 };
            return { rows: [], rowCount: 1 };
          }
        };
        const server = createApp({
          dbPool,
          fabricGateway: { checkReady: async () => undefined },
          logger: { error() {}, info() {} }
        }).listen(0, "127.0.0.1");
        await new Promise((resolve, reject) => {
          server.once("listening", resolve);
          server.once("error", reject);
        });
        try {
          const isolatedOrigin = localOrigin(server.address().port);
          const statuses = [];
          for (let attempt = 0; attempt < 11; attempt += 1) {
            const response = await fetchImpl(`${isolatedOrigin}/api/v1/auth/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                username: "security-test-no-user",
                password: "fixed-invalid-test-password"
              }),
              redirect: "manual",
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });
            await readLimitedBody(response);
            statuses.push(response.status);
          }
          const passed = statuses.slice(0, 10).every((status) => status === 401) && statuses[10] === 429;
          return result(passed ? "PASS" : "FAIL",
            `Isolated login status sequence: ${statuses.join(", ")}.`,
            passed ? "The isolated login rate limiter rejected the bounded excess attempt."
              : "The isolated login rate limiter did not activate at the expected boundary.",
            [{ method: "POST", path: "isolated loopback /api/v1/auth/login (11 attempts)", status: statuses[10], code: "BOUNDED_RATE_LIMIT", assertion: passed }],
            ["A separate ephemeral app with no real accounts was used; the running lab's login limiter was not consumed."]);
        } finally {
          await new Promise((resolve) => server.close(() => resolve()));
        }
      }
      default:
        throw new TypeError("The requested test ID is not allowlisted");
    }
  } catch (error) {
    if (error instanceof PrerequisiteError) {
      return result("ERROR", error.message, "A required local lab prerequisite was unavailable.", requests, notes);
    }
    const code = sanitizeCode(error && error.code);
    const message = error && error.name === "AbortError"
      ? "The fixed local service timed out."
      : `The fixed local test could not complete (${code}).`;
    return result("ERROR", message, "The test did not produce enough evidence to determine the security control.", requests, notes);
  }
}

function markdownCell(value) {
  return String(value ?? "").replace(/[|\r\n]+/g, " ").trim();
}

function toMarkdown(report) {
  return [
    `# ${report.testId} — ${report.name}`,
    "",
    `- Status: **${report.status}**`,
    `- Target: \`${report.target}\``,
    `- Profile: \`${report.profile}\``,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt || "running"}`,
    `- Duration: ${report.durationMs} ms`,
    `- Expected: ${markdownCell(report.expected)}`,
    `- Actual: ${markdownCell(report.actual)}`,
    `- Summary: ${markdownCell(report.summary)}`,
    `- Evidence: ${report.evidence.length ? report.evidence.map((item) => `\`${item}\``).join(", ") : "not yet available"}`,
    `- Finding: ${report.finding ? `${report.finding.severity}: ${markdownCell(report.finding.impact)}; remediation: ${markdownCell(report.finding.remediation)}; retest: ${report.finding.retestResult}` : "none"}`,
    `- Notes: ${report.notes.length ? report.notes.map(markdownCell).join("; ") : "none"}`
  ].join("\n");
}

class SecurityTestRunner {
  constructor({ reportDirectory = REPORT_DIRECTORY, env = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.reportDirectory = reportDirectory;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.activeRun = null;
  }

  getTests() {
    return TEST_CASES.map((testCase) => ({
      ...testCase,
      target: testCase.testId === "AT-14" ? "isolated loopback app" : "127.0.0.1 (local lab only)",
      runnable: this.env.SECURITY_LAB_MODE === "true"
    }));
  }

  async writeReport(report, evidence) {
    const evidenceDirectory = path.join(this.reportDirectory, "evidence");
    await fs.mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      path.join(this.reportDirectory, `${report.runId}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 }
    );
    if (evidence) {
      await fs.writeFile(
        path.join(evidenceDirectory, `${report.runId}.json`),
        `${JSON.stringify(evidence, null, 2)}\n`,
        { mode: 0o600 }
      );
      await fs.writeFile(
        path.join(this.reportDirectory, `${report.runId}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
        { mode: 0o600 }
      );
    }
    await fs.writeFile(
      path.join(this.reportDirectory, `${report.runId}.md`),
      `${toMarkdown(report)}\n`,
      { mode: 0o600 }
    );
  }

  async start(testId, targetPort, { context = "cli" } = {}) {
    const testCase = TESTS_BY_ID.get(testId);
    if (!testCase) throw new TypeError("The requested test ID is not allowlisted");
    if (this.activeRun) throw new TestAlreadyRunningError();
    const origin = localOrigin(targetPort);
    const startedAt = new Date();
    const runId = crypto.randomUUID();
    const report = {
      schemaVersion: "1.1.0",
      runId,
      testId,
      name: testCase.name,
      category: testCase.category,
      risk: testCase.risk,
      target: testId === "AT-14" ? "isolated in-process loopback authentication app" : origin,
      profile: "lab-current",
      status: "RUNNING",
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      durationMs: 0,
      expected: testCase.expected,
      actual: "The test is running.",
      summary: "The allowlisted test has started.",
      evidence: [],
      finding: null,
      notes: [testCase.safeExecutionLimit]
    };
    this.activeRun = runId;
    try {
      await fs.mkdir(this.reportDirectory, { recursive: true, mode: 0o700 });
      await this.writeReport(report);
    } catch (error) {
      if (this.activeRun === runId) this.activeRun = null;
      throw error;
    }
    this.finish(report, testCase, targetPort, startedAt, context)
      .catch(() => undefined)
      .finally(() => {
        if (this.activeRun === runId) this.activeRun = null;
      });
    return {
      runId,
      testId,
      status: "RUNNING",
      startedAt: report.startedAt,
      target: report.target
    };
  }

  async finish(report, testCase, targetPort, startedAt, context) {
    const outcome = await executeTest(report.testId, {
      targetPort,
      env: this.env,
      fetchImpl: this.fetchImpl,
      context
    });
    const finishedAt = new Date();
    report.status = outcome.status;
    report.finishedAt = finishedAt.toISOString();
    report.durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    report.actual = outcome.actual;
    report.summary = outcome.summary;
    report.notes = [...report.notes, ...outcome.notes];
    report.evidence = [context === "api"
      ? `/api/v1/security/runs/${report.runId}/evidence`
      : `tests/reports/security/evidence/${report.runId}.json`];
    report.finding = outcome.status === "FAIL" ? {
      severity: testCase.risk,
      impact: testCase.impact,
      evidence: report.evidence[0],
      remediation: testCase.remediation,
      retestResult: "NOT_RETESTED"
    } : null;
    await this.writeReport(report, {
      schemaVersion: "1.1.0",
      runId: report.runId,
      testId: report.testId,
      target: report.target,
      requests: outcome.evidence.requests
    });
  }

  async waitFor(runId) {
    if (this.activeRun === runId) {
      while (this.activeRun === runId) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    return this.getRun(runId);
  }

  async getRun(runId) {
    if (!isUuid(runId)) return null;
    try {
      const report = JSON.parse(await fs.readFile(path.join(this.reportDirectory, `${runId}.json`), "utf8"));
      return report.runId === runId ? report : null;
    } catch {
      return null;
    }
  }

  async getEvidence(runId) {
    if (!isUuid(runId)) return null;
    try {
      const evidence = JSON.parse(await fs.readFile(
        path.join(this.reportDirectory, "evidence", `${runId}.json`),
        "utf8"
      ));
      return evidence.runId === runId ? evidence : null;
    } catch {
      return null;
    }
  }

  async listRuns() {
    let entries;
    try {
      entries = await fs.readdir(this.reportDirectory, { withFileTypes: true });
    } catch {
      return [];
    }
    const runIds = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5))
      .filter(isUuid);
    const reports = await Promise.all(runIds.map((runId) => this.getRun(runId)));
    return reports
      .filter(Boolean)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, REPORT_LIMIT);
  }

  async getOverview() {
    const runs = await this.listRuns();
    const latestByTest = new Map();
    const profilesByTest = new Map();
    for (const run of runs) {
      if (!latestByTest.has(run.testId)) latestByTest.set(run.testId, run);
      if (!profilesByTest.has(run.testId)) profilesByTest.set(run.testId, {});
      const profiles = profilesByTest.get(run.testId);
      if (["baseline", "hardened"].includes(run.profile) && !profiles[run.profile]) {
        profiles[run.profile] = {
          runId: run.runId,
          status: run.status,
          startedAt: run.startedAt,
          summary: run.summary
        };
      }
    }
    return {
      tests: this.getTests().map((testCase) => ({
        ...testCase,
        latestRun: latestByTest.get(testCase.testId) || null
      })),
      comparisons: TEST_CASES.map((testCase) => ({
        testId: testCase.testId,
        ...(profilesByTest.get(testCase.testId) || {})
      })),
      latestRuns: runs.slice(0, 10)
    };
  }

  async runAndWait(testId, targetPort, context = "cli") {
    const started = await this.start(testId, targetPort, { context });
    return this.waitFor(started.runId);
  }
}

module.exports = {
  REPORT_DIRECTORY,
  SecurityTestRunner,
  TestAlreadyRunningError,
  TEST_CASES,
  TESTS_BY_ID,
  executeTest,
  isUuid,
  localOrigin
};
