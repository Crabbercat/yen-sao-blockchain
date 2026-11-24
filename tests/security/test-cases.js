"use strict";

const REMEDIATION = Object.freeze({
  "AT-01": "Review the unexpected fixed loopback port and restrict exposure to explicitly approved lab services.",
  "AT-02": "Require valid authentication on every protected API route and avoid returning protected data before authorization.",
  "AT-03": "Enforce role and organization authorization before request handling and ledger submission.",
  "AT-04": "Derive authority only from authenticated server-side identity mapping; reject client-supplied role and organization claims.",
  "AT-05": "Enforce lifecycle state and recipient checks in chaincode before any state write.",
  "AT-06": "Make event IDs idempotent and verify history contains one business event for a replay.",
  "AT-07": "Apply the documented endorsement policy and verify it through a real disposable Fabric peer integration test.",
  "AT-08": "Restrict PDC membership and ensure public projections exclude all private terms.",
  "AT-09": "Keep ledger history append-only and expose no application API that rewrites committed state.",
  "AT-10": "Terminate traffic only on a trusted TLS endpoint with a certificate valid for the fixed lab service name.",
  "AT-11": "Review the image/configuration findings and remediate or document accepted risk for the local image digest.",
  "AT-12": "Use only an explicitly approved bounded profile and verify health/recovery without increasing workload dynamically.",
  "AT-13": "Reject invalid content before storage and keep generated storage paths independent of uploaded filenames.",
  "AT-14": "Apply and monitor a bounded login rate limit without testing real accounts or credential lists."
});

const TEST_CASES = Object.freeze([
  {
    testId: "AT-01",
    name: "Network service exposure",
    category: "Network",
    risk: "High",
    objective: "Check only the fixed loopback service ports used by this lab.",
    precondition: "Run against the local backend container; this is not a host or LAN scan.",
    expected: "Only the backend service port is reachable in the tested container namespace.",
    safeExecutionLimit: "Six fixed TCP connection attempts to 127.0.0.1; no port ranges or external addresses.",
    automated: true
  },
  {
    testId: "AT-02",
    name: "Unauthenticated API access",
    category: "API",
    risk: "High",
    objective: "Verify protected endpoints reject missing and invalid bearer tokens.",
    precondition: "The local backend is listening.",
    expected: "Protected API requests return 401 without sensitive response data.",
    safeExecutionLimit: "Two read-only GET requests to fixed local endpoints.",
    automated: true
  },
  {
    testId: "AT-03",
    name: "Broken access control / IDOR",
    category: "API",
    risk: "High",
    objective: "Verify a harvest account cannot call a processing-only endpoint.",
    precondition: "DEMO_USERS_PASSWORD is configured and seeded local demo accounts are active.",
    expected: "The API returns 403 before validating or submitting transaction data.",
    safeExecutionLimit: "One rejected request; no ledger transaction is submitted.",
    automated: true
  },
  {
    testId: "AT-04",
    name: "Fabric identity / organization spoofing",
    category: "Fabric identity",
    risk: "High",
    objective: "Verify request-body role and organization claims cannot override the authenticated account.",
    precondition: "DEMO_USERS_PASSWORD is configured and seeded local demo accounts are active.",
    expected: "Forged identity fields are rejected by strict request validation before Fabric submission.",
    safeExecutionLimit: "One rejected request; no ledger transaction is submitted.",
    automated: true
  },
  {
    testId: "AT-05",
    name: "Invalid lifecycle transition",
    category: "Fabric lifecycle",
    risk: "High",
    objective: "Verify a distributor cannot accept an absent shipment as a valid lifecycle transition.",
    precondition: "DEMO_USERS_PASSWORD is configured and the local Fabric network is ready.",
    expected: "Fabric rejects the request as not found or invalid state; no business record is committed.",
    safeExecutionLimit: "One submit attempt using a fixed, nonexistent security-test shipment ID.",
    automated: true
  },
  {
    testId: "AT-06",
    name: "Duplicate/replay business event",
    category: "Fabric idempotency",
    risk: "Medium",
    objective: "Submit one uniquely named test harvest event twice and verify history contains one event.",
    precondition: "DEMO_USERS_PASSWORD is configured and the local Fabric network is ready.",
    expected: "The repeated event does not create a second business history event.",
    safeExecutionLimit: "Two fixed-shape requests; creates one uniquely prefixed, append-only lab test batch.",
    automated: true
  },
  {
    testId: "AT-07",
    name: "Endorsement policy enforcement",
    category: "Fabric endorsement",
    risk: "High",
    objective: "Verify an invalid endorsement set cannot commit a transaction.",
    precondition: "A disposable Fabric test channel, enrolled test identities, and a known required endorsement policy are available.",
    expected: "A real peer proposal/commit is invalid without the required organizations' endorsements.",
    safeExecutionLimit: "No API-level test can safely fabricate or bypass Fabric endorsements; requires an operator-run isolated integration fixture.",
    automated: false
  },
  {
    testId: "AT-08",
    name: "Private Data Collection access",
    category: "Fabric privacy",
    risk: "High",
    objective: "Verify a non-member cannot access private terms and the public trace omits private fields.",
    precondition: "DEMO_USERS_PASSWORD is configured and the SPEC demo trace batch exists on local Fabric.",
    expected: "The API denies a distributor's private-terms request and public trace contains no private-term fields.",
    safeExecutionLimit: "One denied read and one read-only public trace query.",
    automated: true
  },
  {
    testId: "AT-09",
    name: "Ledger history and tamper detection",
    category: "Fabric integrity",
    risk: "High",
    objective: "Verify the application exposes no history-rewrite route and a rejected update leaves history unchanged.",
    precondition: "DEMO_USERS_PASSWORD is configured and the SPEC demo trace batch exists on local Fabric.",
    expected: "The attempted API update is not found and the before/after ledger histories match.",
    safeExecutionLimit: "One read-only history comparison and one rejected HTTP PUT; no direct ledger or volume access.",
    automated: true
  },
  {
    testId: "AT-10",
    name: "TLS and packet inspection",
    category: "Transport security",
    risk: "High",
    objective: "Verify Fabric Gateway readiness succeeds using the configured trusted TLS roots.",
    precondition: "The backend and local Fabric peers are ready.",
    expected: "The backend readiness check reports Fabric ready after TLS-authenticated peer connections.",
    safeExecutionLimit: "One read-only GET to the fixed local /ready endpoint; no packet capture.",
    automated: true
  },
  {
    testId: "AT-11",
    name: "Container/image misconfiguration",
    category: "Container security",
    risk: "High",
    objective: "Assess local image and container configuration with an approved scanner.",
    precondition: "A separately approved offline scanner setup and image digest are available.",
    expected: "No unaccepted critical/high findings; accepted findings have a recorded decision.",
    safeExecutionLimit: "Not executable by the API; no Docker socket or container-control access is provided.",
    automated: false
  },
  {
    testId: "AT-12",
    name: "Bounded load / availability",
    category: "Availability",
    risk: "Medium",
    objective: "Measure a pre-approved bounded workload and observe service recovery.",
    precondition: "An isolated disposable lab and an explicitly approved low-volume profile are available.",
    expected: "Bounded metrics are recorded and the service remains/reports healthy.",
    safeExecutionLimit: "Not executable by the API; no load generator or user-defined workload is exposed.",
    automated: false
  },
  {
    testId: "AT-13",
    name: "Document integrity and upload validation",
    category: "Document validation",
    risk: "Medium",
    objective: "Verify a tiny invalid text upload with a traversal-style filename is rejected before storage.",
    precondition: "DEMO_USERS_PASSWORD is configured and local demo accounts are active.",
    expected: "The API rejects the invalid MIME/extension and does not create a stored document.",
    safeExecutionLimit: "One 7-byte in-memory multipart request; no file is written.",
    automated: true
  },
  {
    testId: "AT-14",
    name: "Authentication brute-force protection",
    category: "Authentication",
    risk: "Medium",
    objective: "Verify the login rate limiter blocks excess failed attempts in an isolated app instance.",
    precondition: "No external service is required; the test uses an in-memory database stub and loopback listener.",
    expected: "Ten bounded failed logins receive 401 and the next request receives 429.",
    safeExecutionLimit: "Eleven failed login attempts in a separate ephemeral in-process test app; no real user is tested or locked out.",
    automated: true
  }
].map((testCase) => Object.freeze({
  ...testCase,
  impact: `A failure may weaken the ${testCase.category.toLowerCase()} control for this local lab.`,
  remediation: REMEDIATION[testCase.testId]
})));

const TESTS_BY_ID = new Map(TEST_CASES.map((testCase) => [testCase.testId, testCase]));

module.exports = { TEST_CASES, TESTS_BY_ID };
