"use strict";

const path = require("node:path");
const { SecurityTestRunner, TESTS_BY_ID } = require("./runner");

try {
  process.loadEnvFile(path.resolve(__dirname, "..", "..", ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

async function main() {
  const [testId, ...extraArgs] = process.argv.slice(2);
  if (!testId || extraArgs.length > 0 || !TESTS_BY_ID.has(testId)) {
    console.error("Usage: node tests/security/run.js AT-01..AT-14");
    process.exitCode = 2;
    return;
  }

  const runner = new SecurityTestRunner();
  try {
    const report = await runner.runAndWait(testId, 3000);
    if (!report) throw new Error("The run report could not be loaded");
    console.log(JSON.stringify({
      runId: report.runId,
      testId: report.testId,
      status: report.status,
      summary: report.summary,
      report: `tests/reports/security/${report.runId}.json`,
      evidence: report.evidence
    }));
    if (!["PASS"].includes(report.status)) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      error: error.name === "TestAlreadyRunningError" ? "TEST_ALREADY_RUNNING" : "SECURITY_TEST_FAILED",
      message: error.message
    }));
    process.exitCode = 1;
  }
}

main();
