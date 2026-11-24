# SPEC.md --- Yen Sao Blockchain Prototype

> **Project:** Yen Sao Cù Lao Chàm --- Supply Chain Traceability &
> Blockchain Security Lab\
> **Document type:** End-to-end System Implementation Specification\
> **Version:** 1.0.0\
> **Target:** AI coding agents / implementation team\
> **Initial deployment:** Docker Compose on one host\
> **Later deployment:** VMware-based isolated multi-VM security lab\
> **Language:** Vietnamese documentation; English identifiers in code
> and APIs

------------------------------------------------------------------------

## 0. Instructions for implementation agents

This document is the authoritative implementation contract for the
prototype. Agents MUST follow it unless the project owner explicitly
approves a change.

### 0.1 Required working method

1.  Inspect the existing repository before changing files. Preserve
    useful existing work.
2.  Read this entire specification and `README.md` before
    implementation.
3.  Implement in the phases in Section 15. Do not start the frontend
    before the blockchain network and chaincode can be exercised through
    scripts.
4.  Keep all services runnable through Docker Compose. Do not require a
    developer to install PostgreSQL, Fabric binaries, or Node
    dependencies globally.
5.  Provide `.env.example` files, health checks, deterministic seed/demo
    data, and repeatable scripts.
6.  Never commit private keys, enrollment secrets, real credentials,
    `.env` files, or production certificates.
7.  Every security test MUST have:
    -   a stated objective and precondition;
    -   an isolated target and safe execution limit;
    -   a repeatable command or test script;
    -   expected secure behavior;
    -   machine-readable result where practical;
    -   evidence/log location.
8.  Do not claim a test passed unless it was actually executed and its
    result recorded.
9.  Do not implement destructive tests against public networks or real
    Cù Lao Chàm organizations. All offensive tests target only the local
    lab.
10. If a technical choice is blocked by Fabric version compatibility,
    document the issue and choose a compatible pinned version. Do not
    silently upgrade the architecture.

### 0.2 Definition of done

The prototype is complete only when a new developer can clone the
repository and, following the README, run a documented setup command
sequence that:

-   starts a real Hyperledger Fabric network in Docker;
-   creates and joins the channel;
-   deploys the chaincode;
-   initializes demo identities and data;
-   starts the backend and frontend;
-   creates, processes, transfers, and traces a bird-nest batch;
-   demonstrates that unauthorized and invalid transactions are
    rejected;
-   runs the security test suite and produces reports;
-   shuts down and resets the lab safely.

A screenshot-only mockup, in-memory blockchain simulation, or API that
merely writes to PostgreSQL does NOT satisfy this specification.

------------------------------------------------------------------------

# 1. Product objective and scope

## 1.1 Product objective

Build a working prototype of a permissioned supply-chain traceability
system for edible bird's nest products associated with Cù Lao Chàm,
Quảng Nam, Vietnam.

The system records important lifecycle events from harvesting through
processing, quality inspection, packaging, shipment, and distribution.
Authorized organizations submit transactions to Hyperledger Fabric.
Consumers and auditors can query a product's traceability history
through a public read-only interface and QR code.

The same prototype is a controlled cybersecurity lab. It must expose
enough real Fabric components and application interfaces to test
identity, authorization, endorsement, ledger integrity, privacy, network
exposure, container configuration, and availability.

## 1.2 Goals

-   Demonstrate a multi-organization permissioned blockchain.
-   Represent the supply chain using batch IDs and immutable lifecycle
    events.
-   Enforce organization-level and role-level authorization.
-   Demonstrate Fabric endorsement and validation.
-   Preserve traceability when a batch is split into derived batches.
-   Store large files off-chain and anchor their SHA-256 hashes
    on-chain.
-   Provide a simple web interface and REST API.
-   Provide repeatable security tests with evidence and reports.
-   Make later migration from one Docker host to multiple VMware VMs
    possible.

## 1.3 Out of scope

The prototype does not claim to be a production certification system. It
does not initially implement:

-   integration with government certification systems;
-   real payment processing or e-commerce checkout;
-   real IoT sensor integration;
-   production-grade mobile applications;
-   a public permissionless blockchain or cryptocurrency;
-   legally binding proof that physical goods match submitted digital
    records;
-   production high availability, disaster recovery, or regulatory
    compliance certification.

The prototype must clearly label demo data and simulated organizations
as simulated.

## 1.4 Primary users

  -----------------------------------------------------------------------
  User / organization                 Responsibilities
  ----------------------------------- -----------------------------------
  Harvester / collection operator     Register harvested batches and hand
                                      them over

  Processing operator                 Receive raw batches, record
                                      processing, create derived batches

  Distributor                         Receive packaged batches and record
                                      distribution

  Auditor                             Read traceability and verify
                                      records; may record inspection
                                      outcomes if explicitly authorized

  Consumer / guest                    Read public product traceability by
                                      QR or batch code

  System administrator                Manage application accounts and
                                      operational configuration; cannot
                                      silently rewrite Fabric history

  Security tester                     Run approved tests against the
                                      isolated lab
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 2. Architecture decisions

## 2.1 High-level architecture

Use a modular monolith for the application layer and a real Hyperledger
Fabric network for the ledger layer.

``` mermaid
flowchart TB
    Browser[Browser: Admin / Operator / Consumer]
    FE[Frontend: HTML + CSS + Vanilla JS]
    API[Node.js Express REST API]
    Auth[Authentication + Application RBAC]
    Gateway[Fabric Gateway SDK]
    PG[(PostgreSQL)]
    Files[(Local file storage / MinIO optional)]
    subgraph Fabric[Hyperledger Fabric Network]
      CAH[CA OrgHarvest]
      CAP[CA OrgProcessing]
      CAD[CA OrgDistribution]
      subgraph Channel[supplychannel]
        PH[Peer OrgHarvest]
        PP[Peer OrgProcessing]
        PD[Peer OrgDistribution]
        O1[Orderer 1]
        O2[Orderer 2]
        O3[Orderer 3]
      end
    end
    FE --> API
    API --> Auth
    API --> PG
    API --> Files
    API --> Gateway
    Gateway --> PH
    Gateway --> PP
    Gateway --> PD
    PH --- O1
    PP --- O2
    PD --- O3
    CAH -. identity .-> PH
    CAP -. identity .-> PP
    CAD -. identity .-> PD
```

This is a logical architecture. The implementation must follow Fabric's
actual transaction lifecycle and must not simulate endorsement or
ordering in application code.

## 2.2 Technology stack (pinned major versions)

Use compatible pinned versions and commit lockfiles.

  -----------------------------------------------------------------------
  Layer                               Required technology
  ----------------------------------- -----------------------------------
  Blockchain                          Hyperledger Fabric 2.5.x

  Certificate authority               Hyperledger Fabric CA 1.5.x

  Ordering                            Raft ordering service, 3 orderers
                                      for the lab

  Chaincode                           Node.js chaincode supported by the
                                      selected Fabric 2.5 runtime

  Fabric client                       `@hyperledger/fabric-gateway`
                                      Node.js client

  Backend                             Node.js LTS + Express

  Frontend                            HTML5, CSS, Vanilla JavaScript;
                                      served by Express

  Database                            PostgreSQL 16 or a compatible
                                      pinned version

  File storage                        Local mounted storage initially;
                                      MinIO optional extension

  Container runtime                   Docker Engine / Docker Desktop +
                                      Compose v2

  Test framework                      Node.js test runner or Jest;
                                      Supertest for API tests

  Network testing                     Nmap, Wireshark

  Web/API testing                     OWASP ZAP; Burp Suite Community
                                      optional

  Image/config scanning               Trivy

  Performance                         Hyperledger Caliper for Fabric
                                      benchmark; k6 or JMeter for HTTP
                                      API

  Optional monitoring                 Prometheus + Grafana; not a
                                      prerequisite for MVP
  -----------------------------------------------------------------------

Do not use a different ledger implementation or a mock ledger in place
of Fabric.

## 2.3 Initial organization topology

Use three organizations to keep the prototype achievable while still
demonstrating cross-organization trust boundaries.

  -----------------------------------------------------------------------
  MSP ID                  Organization            Main responsibility
  ----------------------- ----------------------- -----------------------
  OrgHarvestMSP           OrgHarvest              Harvesting and
                                                  raw-batch registration

  OrgProcessingMSP        OrgProcessing           Receiving, processing,
                                                  quality record and
                                                  packaging

  OrgDistributionMSP      OrgDistribution         Shipment, receiving and
                                                  distribution
  -----------------------------------------------------------------------

Each organization has:

-   one peer;
-   one Fabric CA;
-   its own MSP identity material;
-   its own application identities;
-   its own CouchDB state database if CouchDB is selected;
-   its own Docker volumes and configuration.

The network has three orderers configured as a Raft consenter set. For a
local prototype, three orderers may run on the same Docker host. This
demonstrates the Raft topology but does NOT provide host-level fault
tolerance.

Use one channel named `supplychannel` for the MVP. Do not create
multiple channels unless a later requirement justifies them. Use Private
Data Collections (PDC) for selected sensitive data.

## 2.4 Trust and security boundaries

-   Each organization controls its own identities and signing
    credentials.
-   Application accounts are not equivalent to Fabric identities.
-   Backend authentication must map an authenticated user to an allowed
    Fabric identity and organization.
-   The chaincode must independently enforce organization/role
    permissions using the transaction creator identity and client
    identity attributes. Backend-only RBAC is insufficient.
-   Consumers must use read-only queries that expose only approved
    public traceability fields.
-   Private keys must never be sent to the browser.
-   Do not expose CA admin credentials, peer admin credentials, orderer
    admin credentials, or Docker socket to the frontend or public API.
-   TLS must be enabled for Fabric service communication in the target
    lab configuration. If the first bootstrap stage temporarily uses a
    simplified local configuration, the limitation must be documented
    and a TLS-enabled configuration must be completed before security
    evaluation.

------------------------------------------------------------------------

# 3. Supply-chain workflow and business rules

## 3.1 Lifecycle

``` mermaid
flowchart TD
    A[Harvest batch registered] --> B[Raw batch handed over]
    B --> C[Processing organization receives batch]
    C --> D[Processing record submitted]
    D --> E[Quality inspection recorded]
    E --> F[Product batch packaged]
    F --> G[Shipment created]
    G --> H[Distributor receives shipment]
    H --> I[Product distributed]
    I --> J[Consumer traces by QR]
```

## 3.2 Batch model

A `HarvestBatch` is the original harvested lot. Processing may create
one or more `ProductBatch` records derived from one or more source
batches. The system must preserve parent-child lineage.

Rules:

1.  Every batch has a globally unique `batchId`.
2.  A batch cannot be processed unless it exists and is in an allowed
    state.
3.  A batch cannot be received by an organization that is not the
    intended recipient.
4.  A handover must be acknowledged by the recipient before the transfer
    is considered complete.
5.  A processing record must reference one or more source batches.
6.  A derived batch must record all parent batch IDs and the quantity
    consumed from each parent.
7.  The total quantity consumed cannot exceed the available quantity of
    a parent batch.
8.  The system must reject negative quantities and invalid units.
9.  A batch cannot be distributed before packaging and any required
    quality inspection.
10. Existing events are append-only. Corrections are represented by a
    new correction/void event referencing the original event; never edit
    historical events in place.
11. Every transaction should include a client-generated idempotency key
    or event ID. Repeated submission of the same event ID must not
    create duplicate business events.
12. Blockchain timestamps are transaction timestamps; do not trust a
    client-supplied timestamp as the authoritative ledger time. Preserve
    both `submittedAt` and Fabric transaction timestamp where useful.

## 3.3 Required lifecycle states

Suggested state model:

-   `HARVESTED`
-   `HANDED_OVER`
-   `RECEIVED`
-   `PROCESSING`
-   `QUALITY_CHECKED`
-   `PACKAGED`
-   `IN_TRANSIT`
-   `DISTRIBUTED`
-   `RECALLED`
-   `CANCELLED`

Implement explicit transition validation in chaincode. Do not allow
arbitrary status updates.

## 3.4 Demo scenario

The seeded demo should support this complete flow:

1.  OrgHarvest registers `YEN-2026-0001`, type `RAW`, quantity `5.5 kg`.
2.  OrgHarvest creates a handover to OrgProcessing.
3.  OrgProcessing acknowledges receipt.
4.  OrgProcessing records cleaning/sorting/processing details.
5.  OrgProcessing records a quality inspection with a result such as
    `PASS` or `FAIL`.
6.  OrgProcessing creates `YEN-2026-0001-A`, referencing the source
    batch and quantity used.
7.  OrgProcessing packages the derived batch and anchors a certificate
    hash.
8.  OrgProcessing hands the packaged batch to OrgDistribution.
9.  OrgDistribution acknowledges receipt and records distribution.
10. Consumer opens `/trace/YEN-2026-0001-A` or scans the generated QR
    code and sees the approved history.

All seed data must be fictional and clearly marked as demo data.

------------------------------------------------------------------------

# 4. Data design

## 4.1 On-chain records

Use JSON objects with stable field names. Include a `docType` field for
CouchDB queries.

### HarvestBatch

``` json
{
  "docType": "HarvestBatch",
  "batchId": "YEN-2026-0001",
  "batchType": "RAW",
  "species": "Swiftlet",
  "harvestLocation": "Cu Lao Cham, Quang Nam, Vietnam",
  "harvestedAt": "2026-11-01T02:00:00.000Z",
  "quantity": 5.5,
  "unit": "kg",
  "ownerMsp": "OrgHarvestMSP",
  "currentOwnerMsp": "OrgHarvestMSP",
  "status": "HARVESTED",
  "createdBy": "harvest.operator",
  "createdAt": "Fabric transaction timestamp"
}
```

### ProcessingRecord

``` json
{
  "docType": "ProcessingRecord",
  "recordId": "PROC-0001",
  "outputBatchId": "YEN-2026-0001-A",
  "inputBatches": [
    {
      "batchId": "YEN-2026-0001",
      "quantityUsed": 5.0,
      "unit": "kg"
    }
  ],
  "processType": "CLEANING_AND_SORTING",
  "facilityId": "PROCESSING-FACILITY-01",
  "notes": "Demo record",
  "createdByMsp": "OrgProcessingMSP",
  "createdAt": "Fabric transaction timestamp"
}
```

### QualityRecord

``` json
{
  "docType": "QualityRecord",
  "qualityId": "QC-0001",
  "batchId": "YEN-2026-0001-A",
  "result": "PASS",
  "standardCode": "DEMO-STANDARD-01",
  "certificateHash": "sha256-hex",
  "documentRef": "certificates/QC-0001.pdf",
  "inspectorMsp": "OrgProcessingMSP",
  "createdAt": "Fabric transaction timestamp"
}
```

### Shipment

``` json
{
  "docType": "Shipment",
  "shipmentId": "SHIP-0001",
  "batchIds": ["YEN-2026-0001-A"],
  "fromMsp": "OrgProcessingMSP",
  "toMsp": "OrgDistributionMSP",
  "status": "CREATED",
  "createdAt": "Fabric transaction timestamp"
}
```

### TraceEvent

Each state-changing operation must append an event containing at least:

-   `eventId`
-   `docType = TraceEvent`
-   `batchId`
-   `eventType`
-   `actorMsp`
-   `actorId` (non-sensitive business identifier)
-   `transactionId`
-   `transactionTimestamp`
-   `details` (allowlisted public fields)
-   `relatedBatchIds`
-   `documentHashes` (when relevant)

Use a composite key or an indexed event key to query a batch's history
in chronological order. Do not rely on unordered database iteration.

## 4.2 Off-chain data

Large files (photos, PDFs, certificates) are stored outside Fabric.

MVP requirements:

-   Store files in a backend-managed directory mounted as a Docker
    volume.
-   Generate a random storage identifier; do not trust a user-supplied
    filesystem path.
-   Validate file type, extension, size, and content where practical.
-   Store SHA-256 digest and metadata on-chain.
-   Never store private keys, passwords, or unnecessary personal data in
    ledger records.
-   Provide a verification endpoint that recomputes the file hash and
    compares it with the on-chain hash.
-   Prevent path traversal and unauthorized download.

MinIO may replace local storage later without changing the chaincode's
document-hash model.

## 4.3 PostgreSQL responsibilities

PostgreSQL is for application-specific data, not the authoritative
traceability ledger.

Suggested tables:

-   `users`: id, username, password_hash, display_name,
    organization_msp, role, status, created_at
-   `refresh_tokens`: hashed token identifier, user_id, expiry,
    revoked_at (if refresh tokens are used)
-   `audit_logs`: actor, action, target, request_id, outcome, created_at
-   `file_metadata`: storage_id, original_name, mime_type, size_bytes,
    sha256, uploaded_by, created_at
-   `security_test_runs`: run_id, test_id, target, status, started_at,
    finished_at, evidence_path

Do not store raw passwords or bearer tokens. Use Argon2id or bcrypt with
a suitable cost. Use parameterized SQL and least-privilege database
credentials.

------------------------------------------------------------------------

# 5. Smart contract / chaincode specification

## 5.1 Chaincode package

Create a chaincode package named `yen-sao-contract` using the Node.js
Fabric chaincode API compatible with Fabric 2.5.

Suggested contract classes:

-   `BatchContract`
-   `TransferContract`
-   `ProcessingContract`
-   `QualityContract`
-   `ShipmentContract`
-   `TraceabilityContract`
-   `AdminQueryContract` (read-only administrative queries; no arbitrary
    ledger mutation)

Keep the implementation modular. Add unit tests for validation and
authorization logic.

## 5.2 Required transaction functions

  -----------------------------------------------------------------------
  Function                Type                    Authorized organization
  ----------------------- ----------------------- -----------------------
  `CreateHarvestBatch`    Submit                  OrgHarvest

  `GetBatch`              Evaluate                Authorized members /
                                                  public projection

  `GetBatchHistory`       Evaluate                Authorized members /
                                                  public projection

  `CreateHandover`        Submit                  Current owner

  `AcceptHandover`        Submit                  Intended recipient

  `RecordProcessing`      Submit                  OrgProcessing

  `CreateDerivedBatch`    Submit                  OrgProcessing

  `RecordQualityCheck`    Submit                  Authorized quality role

  `PackageBatch`          Submit                  OrgProcessing

  `CreateShipment`        Submit                  Current owner

  `AcceptShipment`        Submit                  Intended recipient

  `RecordDistribution`    Submit                  OrgDistribution

  `AddCorrectionEvent`    Submit                  Authorized auditor /
                                                  record owner under
                                                  explicit policy

  `GetBatchLineage`       Evaluate                Authorized members /
                                                  public projection

  `VerifyDocumentHash`    Evaluate                Authorized members /
                                                  public projection

  `GetPublicTrace`        Evaluate                Public-safe fields only
  -----------------------------------------------------------------------

Use clear error codes/messages. Never leak private record values in an
authorization error.

## 5.3 Identity and authorization

Use Fabric client identity attributes or MSP ID checks in chaincode.

Minimum attributes:

-   `role`: `harvest_operator`, `processing_operator`,
    `quality_inspector`, `distributor`, `auditor`, `org_admin`
-   `org`: organization name
-   `canWrite`: `true` or `false` where useful

Rules:

-   Only OrgHarvest may create a harvest batch.
-   Only the current owner may initiate a handover.
-   Only the intended receiving organization may accept a handover.
-   Only OrgProcessing may record processing and create derived product
    batches.
-   Only an authorized quality role may create quality records.
-   Only OrgDistribution may record distribution.
-   Consumers are read-only and must receive a filtered public
    projection.
-   An auditor may query history but cannot silently rewrite it.
-   A user must not gain authority merely by supplying an `organization`
    or `role` field in the request body. Authority comes from the
    verified Fabric identity and server-side account mapping.

## 5.4 Endorsement policy

Implement and document endorsement policies at chaincode/collection
level.

MVP policy examples:

-   Harvest creation: endorsement by OrgHarvest peer.
-   Handover/receipt: require the relevant current-owner and recipient
    organization endorsements where the transaction design supports it.
-   Processing output: require OrgProcessing endorsement; where the
    business rule requires source ownership confirmation, require
    OrgHarvest and OrgProcessing endorsements.
-   Quality record: require OrgProcessing endorsement; if an independent
    auditor organization is added later, update policy to require its
    endorsement.
-   Distribution receipt: require OrgProcessing and OrgDistribution
    endorsements where appropriate.

Important: distinguish application authorization from Fabric endorsement
policy. The former decides who may request an operation; the latter
decides which peer organizations must endorse a proposal for it to
validate.

Agents must implement a policy matrix and tests showing valid and
invalid endorsement cases. Do not claim that a policy is enforced unless
the test invokes the transaction through real Fabric peers and observes
commit/validation status.

## 5.5 Private Data Collection

Create at least one PDC for sensitive inter-organization data, for
example:

-   commercial price;
-   contract reference;
-   private supplier notes.

Only define PDC members who need the information. Public traceability
must not reveal private fields. Test a non-member query and prove that
the private value is unavailable.

------------------------------------------------------------------------

# 6. Fabric network and Docker implementation

## 6.1 Network requirements

Use Fabric 2.5.x and Fabric CA 1.5.x. Pin images by version; avoid
`latest`.

Required components:

-   3 organization CAs;
-   3 peers (one per organization);
-   3 Raft orderers;
-   one channel: `supplychannel`;
-   chaincode `yen-sao-contract`;
-   CouchDB state database per peer if using CouchDB;
-   TLS certificates and MSP material;
-   persistent Docker volumes for ledger, state database, CA data, and
    orderer data.

The local Docker network should be a dedicated bridge network. Only
publish ports required by the host-side application and approved test
tools. Do not publish every internal Fabric port to all interfaces.

## 6.2 Repository layout

Keep the existing top-level folders. Agents may add files and nested
folders as follows:

``` text
yen-sao-blockchain/
├── backend/
│   ├── src/
│   │   ├── app.js
│   │   ├── server.js
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── batches/
│   │   │   ├── transfers/
│   │   │   ├── processing/
│   │   │   ├── quality/
│   │   │   ├── shipments/
│   │   │   ├── traceability/
│   │   │   └── security/
│   │   ├── fabric/
│   │   │   ├── gateway.js
│   │   │   ├── identity-resolver.js
│   │   │   └── contract-service.js
│   │   ├── db/
│   │   └── utils/
│   ├── migrations/
│   ├── scripts/
│   ├── tests/
│   ├── package.json
│   └── Dockerfile
├── blockchain/
│   ├── network/
│   │   ├── compose/
│   │   ├── config/
│   │   ├── organizations/
│   │   ├── scripts/
│   │   ├── channel-artifacts/
│   │   └── README.md
│   ├── chaincode/
│   │   └── yen-sao-contract/
│   │       ├── lib/
│   │       ├── test/
│   │       ├── index.js
│   │       └── package.json
│   └── gateway/
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── README.md
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── security/
│   ├── deployment/
│   ├── threat-model.md
│   └── data-dictionary.md
├── frontend/
│   ├── public/
│   │   ├── index.html
│   │   ├── login.html
│   │   ├── dashboard.html
│   │   ├── batches.html
│   │   ├── batch-detail.html
│   │   ├── security.html
│   │   ├── css/
│   │   └── js/
│   └── README.md
├── tests/
│   ├── integration/
│   ├── security/
│   │   ├── api/
│   │   ├── fabric/
│   │   ├── network/
│   │   ├── infrastructure/
│   │   └── performance/
│   ├── fixtures/
│   ├── scripts/
│   └── reports/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
└── SPEC.md
```

Agents may adjust internal file names, but MUST preserve the existing
top-level folder intent and update documentation.

## 6.3 Docker Compose profiles

Provide profiles or separate Compose files for:

-   `app`: backend, frontend (or backend-served frontend), PostgreSQL;
-   `fabric`: CA, peers, orderers, CouchDB;
-   `security`: optional ZAP baseline container and supporting test
    utilities;
-   `monitoring`: optional Prometheus/Grafana.

Suggested commands:

``` bash
# Validate compose configuration
docker compose config

# Start infrastructure
docker compose --profile fabric up -d

# Deploy channel and chaincode using scripts
./blockchain/network/scripts/deploy.sh

# Start application services
docker compose --profile app up -d --build

# Inspect
docker compose ps
docker compose logs -f backend
```

If profiles make dependency orchestration awkward, provide a single
default Compose file plus documented override files. The commands in
README must be tested on the target OS.

## 6.4 Network bootstrap scripts

Provide idempotent scripts:

-   `check-prerequisites.sh`
-   `up.sh`
-   `create-identities.sh`
-   `create-channel.sh`
-   `join-channel.sh`
-   `deploy-chaincode.sh`
-   `seed-demo.sh`
-   `health-check.sh`
-   `down.sh`
-   `reset-lab.sh`

PowerShell equivalents may be provided for Windows, but WSL2 shell
scripts are the primary path.

Scripts must fail fast, print actionable errors, and not delete
persistent volumes unless an explicit destructive reset flag is
supplied.

------------------------------------------------------------------------

# 7. Backend specification

## 7.1 Service responsibilities

Backend is a Node.js Express modular monolith.

It must:

-   authenticate application users;
-   enforce API-level RBAC;
-   resolve the user's permitted Fabric identity;
-   connect to Fabric using Gateway SDK;
-   expose REST APIs;
-   validate input;
-   upload and verify off-chain documents;
-   write application audit logs;
-   expose health/readiness endpoints;
-   return consistent errors.

Backend must not become a replacement ledger. The blockchain remains
authoritative for traceability events and ownership transitions.

## 7.2 API conventions

Base path: `/api/v1`

Use JSON request/response bodies. Use ISO 8601 UTC timestamps. Validate
all request bodies with a schema library such as Zod or Joi.

Standard error format:

``` json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "The current identity is not allowed to perform this operation",
    "requestId": "req-...",
    "details": []
  }
}
```

Do not return stack traces, private certificate paths, secrets, or raw
Fabric private data to clients.

## 7.3 Required endpoints

### Health and authentication

  Method   Endpoint                Purpose
  -------- ----------------------- ----------------------------------
  GET      `/health`               Liveness
  GET      `/ready`                Backend, DB and Fabric readiness
  POST     `/api/v1/auth/login`    Login
  POST     `/api/v1/auth/logout`   Logout/revoke session
  GET      `/api/v1/auth/me`       Current user and role

### Batches and processing

  Method   Endpoint                                 Purpose
  -------- ---------------------------------------- ------------------------------
  POST     `/api/v1/batches/harvest`                Create harvest batch
  GET      `/api/v1/batches`                        List batches visible to user
  GET      `/api/v1/batches/:batchId`               Batch details
  POST     `/api/v1/batches/:batchId/handover`      Initiate handover
  POST     `/api/v1/transfers/:transferId/accept`   Accept handover
  POST     `/api/v1/batches/:batchId/processing`    Record processing
  POST     `/api/v1/batches/:batchId/derived`       Create derived batch
  POST     `/api/v1/batches/:batchId/quality`       Record quality check
  POST     `/api/v1/batches/:batchId/package`       Package batch

### Shipment and traceability

  --------------------------------------------------------------------------------------------
  Method                  Endpoint                                     Purpose
  ----------------------- -------------------------------------------- -----------------------
  POST                    `/api/v1/shipments`                          Create shipment

  POST                    `/api/v1/shipments/:shipmentId/accept`       Accept shipment

  POST                    `/api/v1/shipments/:shipmentId/distribute`   Record distribution

  GET                     `/api/v1/trace/:batchId`                     Public-safe
                                                                       traceability

  GET                     `/api/v1/batches/:batchId/history`           Authorized full history

  GET                     `/api/v1/batches/:batchId/lineage`           Parent-child batch
                                                                       lineage
  --------------------------------------------------------------------------------------------

### Documents

  ---------------------------------------------------------------------------------------
  Method                  Endpoint                                Purpose
  ----------------------- --------------------------------------- -----------------------
  POST                    `/api/v1/documents`                     Upload document

  GET                     `/api/v1/documents/:storageId`          Authorized download

  POST                    `/api/v1/documents/:storageId/verify`   Verify SHA-256 against
                                                                  ledger
  ---------------------------------------------------------------------------------------

### Security lab

  --------------------------------------------------------------------------------------
  Method                  Endpoint                               Purpose
  ----------------------- -------------------------------------- -----------------------
  GET                     `/api/v1/security/overview`            Show enabled checks and
                                                                 latest results

  GET                     `/api/v1/security/tests`               List test definitions

  POST                    `/api/v1/security/tests/:testId/run`   Run an allowlisted safe
                                                                 test

  GET                     `/api/v1/security/runs`                List test runs

  GET                     `/api/v1/security/runs/:runId`         Run result and evidence
                                                                 metadata
  --------------------------------------------------------------------------------------

Security endpoints must be restricted to the `security_admin` role.
Never expose arbitrary shell execution, arbitrary Nmap target input,
arbitrary file paths, Docker socket operations, or arbitrary command
strings through the API.

For the MVP, security test execution should call fixed scripts with
validated parameters and fixed lab targets. The UI must display a clear
warning before a test that generates traffic.

## 7.4 Application roles

-   `harvest_operator`
-   `processing_operator`
-   `quality_inspector`
-   `distributor`
-   `auditor`
-   `consumer`
-   `security_admin`
-   `system_admin`

A role in PostgreSQL does not automatically grant a Fabric identity
attribute. The backend must map a user to an enrolled Fabric identity,
and chaincode must verify the identity/attributes on every write
transaction.

## 7.5 API security requirements

-   Use secure password hashing (Argon2id preferred; bcrypt acceptable).
-   Use short-lived access tokens or secure server-side sessions.
-   If using cookies, set HttpOnly, Secure in TLS deployment, and
    appropriate SameSite.
-   Add rate limits to login and sensitive routes.
-   Configure CORS with an explicit allowlist.
-   Use Helmet or equivalent secure headers.
-   Validate content type, body size, and all user input.
-   Use parameterized SQL.
-   Prevent IDOR by checking ownership/organization access on every
    resource.
-   Add request IDs and structured logs.
-   Do not log passwords, tokens, private keys, certificate private
    material, or private collection contents.
-   Configure a least-privilege PostgreSQL user.
-   Never mount `/var/run/docker.sock` into the backend container.

------------------------------------------------------------------------

# 8. Frontend specification

## 8.1 Technology and design

Use simple responsive HTML, CSS, and Vanilla JavaScript. Serve static
assets through Express. No separate React build system is required for
the MVP.

Visual style: clean administrative dashboard, neutral background, dark
blue/teal accents, clear status badges, usable on desktop and tablet. Do
not prioritize animations.

## 8.2 Required pages

1.  **Login**
    -   username and password;
    -   demo user hints in development mode only;
    -   display authentication errors.
2.  **Dashboard**
    -   total batches;
    -   batches by lifecycle status;
    -   recent events;
    -   Fabric/backend connection status;
    -   latest security test summary.
3.  **Batch management**
    -   list/search/filter by batch ID, type, status;
    -   create harvest batch (OrgHarvest role only);
    -   view batch detail and event history.
4.  **Batch detail**
    -   current owner and state;
    -   quantity and unit;
    -   timeline of trace events;
    -   parent-child lineage;
    -   document hash verification status;
    -   permitted action buttons based on role and state.
5.  **Processing and quality**
    -   processing form;
    -   create derived batch;
    -   quality result form;
    -   package action.
6.  **Shipment and distribution**
    -   create shipment;
    -   recipient accepts shipment;
    -   distributor records distribution.
7.  **Public traceability**
    -   search by batch ID;
    -   QR code or downloadable QR image;
    -   display only public-safe fields and approved event history;
    -   do not require login for public trace.
8.  **Security Testing Dashboard**
    -   list AT-01 onward with category, objective, risk, target and
        safe execution note;
    -   run only allowlisted tests;
    -   show status: `NOT_RUN`, `RUNNING`, `PASS`, `FAIL`, `ERROR`;
    -   show timestamps, duration, summary, and evidence link;
    -   compare baseline and hardened results where available.

## 8.3 Frontend security

-   Never store Fabric private keys in browser storage.
-   Do not put privileged secrets in JavaScript bundles.
-   Escape untrusted text before rendering.
-   Do not use `innerHTML` with untrusted values.
-   Do not expose admin-only endpoints or controls to consumer users.
-   Hiding a button is not authorization; backend and chaincode must
    enforce the permission.

------------------------------------------------------------------------

# 9. Security testing specification

## 9.1 Test philosophy

The purpose is to evaluate the prototype, not to attack real
infrastructure. All tests must run only against the project's local
Docker/VMware lab.

Use a baseline configuration and a hardened configuration. Capture the
exact configuration and software versions for each run.

Each test produces a JSON result and a human-readable summary under
`tests/reports/`.

Common result schema:

``` json
{
  "testId": "AT-01",
  "name": "Unauthorized API access",
  "target": "http://backend:3000",
  "status": "PASS",
  "startedAt": "ISO-8601",
  "finishedAt": "ISO-8601",
  "durationMs": 0,
  "expected": "Request is rejected with 401 or 403",
  "actual": "HTTP 401",
  "evidence": ["tests/reports/evidence/AT-01-response.txt"],
  "notes": "Executed against local lab"
}
```

For security tests, `PASS` means the security control behaved as
expected. For example, an unauthorized request being denied is a passing
security test. Use explicit `VULNERABLE` or `FAIL` status when the
attack succeeds unexpectedly.

## 9.2 Required test cases

### AT-01 --- Network service exposure

-   Tool: Nmap.
-   Target: explicitly configured local lab IP or Docker host.
-   Objective: enumerate open ports and identify unintended exposed
    services.
-   Expected: only documented host-facing ports are reachable from the
    test network.
-   Evidence: Nmap output and approved port inventory.
-   Safety: no scanning public IP ranges.

### AT-02 --- Unauthenticated API access

-   Tool: curl, Supertest, OWASP ZAP.
-   Objective: call protected API endpoints without credentials.
-   Expected: HTTP 401; no sensitive data returned.
-   Also test invalid/expired tokens.

### AT-03 --- Broken access control / IDOR

-   Tool: Supertest, ZAP or Burp.
-   Objective: a user from OrgHarvest tries to access or mutate an
    OrgProcessing-only resource.
-   Expected: HTTP 403 or a safe not-found response; no state change on
    ledger.
-   Verify both API and chaincode enforcement.

### AT-04 --- Fabric identity / organization spoofing

-   Objective: submit a request body claiming a different organization
    or role.
-   Expected: backend ignores untrusted organization claims; chaincode
    uses verified Fabric identity.
-   Evidence: request, response, transaction status, ledger query.

### AT-05 --- Invalid lifecycle transition

-   Objective: distribute a batch before packaging/quality requirements
    are satisfied.
-   Expected: chaincode rejects the transaction; no invalid state is
    committed.

### AT-06 --- Duplicate/replay business event

-   Objective: submit the same event ID/idempotency key twice.
-   Expected: second submission does not create a second business event.
    Document Fabric transaction behavior separately from application
    idempotency.
-   Do not claim all replay is prevented by Fabric automatically.

### AT-07 --- Endorsement policy enforcement

-   Objective: submit a proposal without the required organization
    endorsements.
-   Expected: transaction is not validly committed. Capture
    proposal/commit status and validation code.
-   Must be tested against the actual Fabric network, not a mocked
    function.

### AT-08 --- Private Data Collection access

-   Objective: query a private key/value as a non-member organization.
-   Expected: private value is unavailable; public trace endpoint never
    returns it.
-   Evidence: authorized and unauthorized query results.

### AT-09 --- Ledger history and tamper detection

-   Objective: demonstrate that normal application APIs cannot rewrite
    committed history; test integrity verification and peer consistency.
-   Expected: historical events remain append-only and invalid updates
    are rejected.
-   Optional destructive experiment: operate only on a disposable lab
    volume/snapshot to demonstrate the consequences of direct filesystem
    tampering. Never perform on the only copy of the lab.
-   Distinguish Fabric ledger validation from OS-level tamper detection.
    Fabric does not magically protect a compromised host administrator.

### AT-10 --- TLS and packet inspection

-   Tool: Wireshark / OpenSSL.
-   Objective: inspect permitted traffic and verify TLS configuration.
-   Expected: credentials and application payloads are not readable in
    transit on TLS-protected links.
-   Do not capture unrelated host traffic.

### AT-11 --- Container/image misconfiguration

-   Tool: Trivy and Docker Bench for Security.
-   Objective: scan images, packages, Docker configuration, mounted
    volumes and privileged settings.
-   Expected: no unaccepted critical/high findings; every accepted
    finding has a documented risk decision.
-   Record image digest and scanner database date.

### AT-12 --- Bounded load / availability test

-   Tool: Hyperledger Caliper for Fabric transactions; k6 or JMeter for
    API.
-   Objective: measure throughput, latency, error rate and resource use.
-   Run with defined low, medium and high test profiles.
-   Do not perform uncontrolled flooding or destructive DoS.
-   Expected: metrics are recorded and service recovery is observed.

### AT-13 --- Document integrity and upload validation

-   Objective: upload an allowed file, verify its hash, then test a
    modified copy and invalid file type/size/path.
-   Expected: modified file fails hash verification; invalid files and
    path traversal attempts are rejected.

### AT-14 --- Authentication brute-force protection

-   Objective: perform a small, bounded series of failed logins against
    the local lab.
-   Expected: rate limit/temporary lockout or equivalent protection is
    activated and logged.
-   Never use credential lists or test real accounts.

## 9.3 Security test implementation

Tests must be scripts or automated test cases, not merely manual
instructions.

Suggested layout:

``` text
tests/security/
├── api/
│   ├── at-02-unauthenticated.test.js
│   ├── at-03-access-control.test.js
│   └── at-14-login-rate-limit.test.js
├── fabric/
│   ├── at-04-identity-spoofing.test.js
│   ├── at-05-invalid-transition.test.js
│   ├── at-06-duplicate-event.test.js
│   ├── at-07-endorsement-policy.test.js
│   └── at-08-private-data.test.js
├── network/
│   ├── at-01-port-inventory.sh
│   └── at-10-tls-check.sh
├── infrastructure/
│   ├── at-11-trivy-scan.sh
│   └── at-09-integrity-check.sh
└── performance/
    ├── caliper/
    └── api/
```

Test runners must use an allowlist of test IDs and fixed lab targets. Do
not accept arbitrary shell commands from the browser or API.

## 9.4 Baseline and hardened profiles

Provide two documented profiles:

**Baseline (controlled intentionally weak configuration):** - only
include weaknesses that are safe and isolated; - do not intentionally
expose the Docker socket, host credentials, or real secrets; - examples:
a deliberately permissive test endpoint, missing application role check
in a test-only route, or a documented non-TLS test listener on an
isolated network; - clearly label as insecure and never use outside the
lab.

**Hardened:** - TLS enabled; - least-privilege identities; - chaincode
authorization; - explicit endorsement policy; - PDC; - API
authentication and authorization; - rate limiting; - secure headers and
input validation; - restricted port exposure; - non-root containers
where compatible; - secrets supplied through protected files/environment
and excluded from Git.

The baseline must be reproducible and reversible. Do not make the only
deployment configuration insecure by default.

------------------------------------------------------------------------

# 10. VMware migration plan

The initial target is Docker on one host. Do not make VMware a
prerequisite for the first working prototype.

After Docker MVP acceptance, provide a second deployment topology:

  -----------------------------------------------------------------------
  VM                      Suggested OS            Responsibility
  ----------------------- ----------------------- -----------------------
  VM-1                    Ubuntu Server LTS       OrgHarvest peer + CA

  VM-2                    Ubuntu Server LTS       OrgProcessing peer + CA

  VM-3                    Ubuntu Server LTS       OrgDistribution peer +
                                                  CA

  VM-4                    Ubuntu Server LTS       Ordering service (3
                                                  orderers may be
                                                  colocated for lab
                                                  only) + monitoring

  VM-5                    Kali Linux              Attacker

  VM-6                    Ubuntu Desktop/Server   Defender, packet
                                                  analysis and monitoring
  -----------------------------------------------------------------------

For a lower-resource lab, combine VM-1/2/3 roles while preserving
distinct Docker services and organization identities. Clearly document
that co-location reduces isolation.

Network plan:

-   use a dedicated VMware Host-only or custom virtual network for the
    lab;
-   assign stable private IPs;
-   do not bridge the attacker VM to a public or institutional network
    for testing;
-   permit only required peer/orderer/CA/application ports between
    designated VMs;
-   configure host firewall rules;
-   keep the management interface separate where possible;
-   ensure the attacker VM cannot reach unrelated host or LAN systems.

The Fabric network must use DNS names/certificates that remain valid
across VM migration. Do not hardcode `localhost` for peer/orderer
addresses in a multi-VM configuration. Use environment-specific
connection profiles and certificate SANs.

Provide: - `docs/deployment/docker.md` - `docs/deployment/vmware.md` -
environment-specific connection profiles; - port matrix; - network
diagram; - migration checklist.

------------------------------------------------------------------------

# 11. Configuration, secrets and operational safety

## 11.1 Environment variables

Create `.env.example` with placeholders only. Example keys:

``` dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://yen_sao_app:change_me@postgres:5432/yen_sao
JWT_SECRET=replace_with_long_random_value
FABRIC_CHANNEL=supplychannel
FABRIC_CHAINCODE=yen-sao-contract
FABRIC_MSP_ID=OrgHarvestMSP
FABRIC_PEER_ENDPOINT=peer0.org-harvest.example.com:7051
FABRIC_TLS_ENABLED=true
FILE_STORAGE_PATH=/app/storage
SECURITY_LAB_MODE=true
```

Do not commit a real `.env`. Do not use the example values as production
credentials.

Fabric connection details are organization-specific. Implement a secure
identity resolver; do not assume one shared admin identity for every
user or organization.

## 11.2 Secrets

-   Keep enrollment secrets and private keys out of source control.
-   Restrict file permissions on crypto material.
-   Use Docker secrets or protected mounted files where practical.
-   Never expose crypto material in API responses or logs.
-   Include a secret/crypto cleanup procedure for disposable lab resets.
-   Do not commit generated `organizations/` crypto material unless the
    project owner explicitly chooses a disposable demo-only workflow and
    understands the risk. Prefer generating it locally.

## 11.3 Logging

Use structured JSON logs with: - timestamp; - level; - service; -
request ID; - user ID (non-sensitive internal ID); - organization MSP
ID; - action; - transaction ID if available; - outcome and error code.

Do not log passwords, bearer tokens, private keys, full certificate
private material, or PDC values.

------------------------------------------------------------------------

# 12. Non-functional requirements

  -----------------------------------------------------------------------
  Area                                Requirement
  ----------------------------------- -----------------------------------
  Reproducibility                     Clean setup from documented
                                      commands

  Maintainability                     Modular backend and chaincode

  Security                            Deny by default; least privilege

  Traceability                        Batch history and lineage query

  Integrity                           Append-only business events and
                                      document hash verification

  Availability                        Health checks and bounded recovery
                                      tests

  Performance                         Record TPS, latency and error rate

  Usability                           Simple responsive operator and
                                      consumer UI

  Observability                       Structured logs and test reports

  Portability                         Docker Compose first; VMware
                                      deployment guide later
  -----------------------------------------------------------------------

Do not claim production performance from a single-host local benchmark.
State the environment and limitations with every result.

------------------------------------------------------------------------

# 13. Required documentation and deliverables

The project must contain:

1.  `README.md` --- quick start, prerequisites, commands, demo users,
    troubleshooting.
2.  `SPEC.md` --- this specification.
3.  `docs/architecture/system-architecture.md` --- component and
    deployment diagrams.
4.  `docs/architecture/sequence-diagrams.md` --- transaction and
    handover flows.
5.  `docs/data-dictionary.md` --- on-chain/off-chain data definitions.
6.  `docs/api/openapi.yaml` --- REST API contract.
7.  `docs/security/threat-model.md` --- assets, trust boundaries,
    threats, mitigations.
8.  `docs/security/test-plan.md` --- test cases, expected outcomes and
    scope.
9.  `docs/security/results-template.md` --- report template.
10. `docs/deployment/docker.md` --- Docker deployment.
11. `docs/deployment/vmware.md` --- later VM topology and migration.
12. `tests/reports/` --- generated test results and evidence (exclude
    secrets).
13. `.env.example` --- configuration template.
14. `docker-compose.yml` and Dockerfiles.
15. Chaincode and backend automated tests.

------------------------------------------------------------------------

# 14. Acceptance criteria

The project owner should verify each item. Agents must report evidence
and exact commands.

## 14.1 Blockchain

-   [ ] Three organizations have distinct MSP identities.
-   [ ] Three peers join `supplychannel`.
-   [ ] Three Raft orderers form the configured ordering service.
-   [ ] Fabric CA enrollment works for each organization.
-   [ ] Chaincode is installed/approved/committed according to Fabric
    lifecycle.
-   [ ] A valid harvest transaction commits.
-   [ ] Invalid lifecycle transitions are rejected.
-   [ ] Unauthorized organization writes are rejected by chaincode.
-   [ ] Cross-organization endorsement requirement is demonstrated.
-   [ ] Batch history and lineage are queryable.
-   [ ] PDC access is restricted to members.
-   [ ] Restarting containers with persistent volumes preserves ledger
    state.

## 14.2 Backend and frontend

-   [ ] Login works for seeded demo identities.
-   [ ] Roles and organization boundaries are enforced by API.
-   [ ] Backend submits and evaluates real Fabric transactions.
-   [ ] User can create a harvest batch, process it, package it,
    transfer it and distribute it.
-   [ ] Consumer can query public traceability without seeing private
    data.
-   [ ] QR code opens the public trace page.
-   [ ] Document hash verification detects a changed file.
-   [ ] Dashboard shows backend/Fabric readiness.
-   [ ] No privileged secret is sent to the browser.

## 14.3 Security

-   [ ] All test cases AT-01 through AT-14 have definitions.
-   [ ] At least AT-02 through AT-09 are automated or reproducibly
    scripted.
-   [ ] Network and infrastructure tests are scripted with explicit lab
    targets.
-   [ ] Load tests have bounded profiles.
-   [ ] Results are saved in JSON and summarized in Markdown.
-   [ ] A baseline and hardened comparison is documented.
-   [ ] Tests do not target systems outside the lab.
-   [ ] Findings include severity, evidence, impact, remediation and
    retest result.

## 14.4 Deployment

-   [ ] A clean Docker deployment can be started from README.
-   [ ] Health checks report service readiness.
-   [ ] `down` preserves data unless reset is explicitly requested.
-   [ ] `reset-lab` clearly warns that it deletes lab state.
-   [ ] VMware migration guide documents IPs, DNS, ports, TLS SANs and
    volumes.

------------------------------------------------------------------------

# 15. Implementation plan for AI coding agents

Agents should execute these phases in order. Each phase must end with a
short report: files changed, commands executed, test results, known
issues, and next phase.

## Phase 0 --- Repository reconnaissance

Tasks: - inspect all current files and folders; - read README and
existing implementation; - identify OS assumptions and current
Node/Fabric versions; - do not delete existing files; - create a short
implementation checklist.

Deliverable: `docs/implementation-status.md`.

Exit criteria: existing repository state is understood and planned file
changes are listed.

## Phase 1 --- Project skeleton and Docker foundation

Tasks: - create root Compose configuration; - add PostgreSQL service and
persistent volume; - add backend Dockerfile and minimal Express health
endpoint; - add frontend static page served by Express; - add
`.env.example` and `.gitignore` updates; - add health checks.

Exit criteria: - `docker compose config` succeeds; - app and PostgreSQL
start; - `/health` and `/ready` work; - frontend loads.

## Phase 2 --- Fabric network

Tasks: - pin Fabric and Fabric CA versions; - create three organization
CA/MSP configurations; - create three peers and three Raft orderers; -
configure TLS and Docker network; - create `supplychannel`; - join all
peers; - implement health-check and reset scripts.

Exit criteria: - all expected containers are healthy; - all peers have
joined the channel; - orderer cluster is operational; - ledger data
survives a normal container restart.

## Phase 3 --- Chaincode

Tasks: - create Node.js chaincode package; - implement data models and
lifecycle transactions; - implement identity/organization/role checks; -
implement event history and lineage; - implement idempotency; -
implement PDC; - configure endorsement policy; - write unit and
real-network integration tests.

Exit criteria: - valid demo flow succeeds; - invalid transitions and
unauthorized calls fail; - endorsement behavior is demonstrated on real
peers; - history and lineage queries return deterministic results.

## Phase 4 --- Backend

Tasks: - implement PostgreSQL migrations and demo seed users; -
implement authentication and RBAC; - implement Fabric Gateway connection
per organization identity; - implement required REST endpoints; -
implement file upload/hash verification; - add validation, rate
limiting, secure headers and structured logging; - add API integration
tests.

Exit criteria: - backend can complete the full business flow using
Fabric; - role and organization restrictions are tested; - no direct
PostgreSQL write is used as a substitute for a ledger transaction.

## Phase 5 --- Frontend

Tasks: - implement login; - implement dashboard; - implement batch list
and detail; - implement processing, quality and shipment forms; -
implement public traceability page and QR; - implement security
dashboard; - show meaningful loading, empty and error states.

Exit criteria: - a demo user can complete the workflow through the
browser; - consumer can scan/open QR trace; - UI does not expose private
or admin-only data.

## Phase 6 --- Security test suite

Tasks: - implement AT-01 through AT-14; - add allowlisted test runner; -
define baseline and hardened profiles; - save JSON/Markdown evidence; -
add security dashboard result view; - document safe test scope and
limitations.

Exit criteria: - security tests can be repeated; - results distinguish
secure rejection from unexpected attack success; - tests are limited to
lab targets.

## Phase 7 --- Hardening and regression

Tasks: - run all application and chaincode tests; - scan Docker
images; - inspect exposed ports and TLS; - fix critical/high findings or
document accepted risk; - rerun affected tests; - verify persistent
state and reset procedure.

Exit criteria: - acceptance criteria are checked; - no unresolved
critical issue is hidden; - known limitations are documented.

## Phase 8 --- VMware migration preparation

Tasks: - write multi-VM deployment guide; - define stable hostnames and
IP plan; - update Fabric connection profiles for remote endpoints; -
document certificate SAN requirements; - define firewall/port matrix; -
test a small multi-VM deployment if resources permit.

Exit criteria: - Docker deployment remains the primary reproducible
baseline; - VMware plan is actionable and does not rely on localhost
assumptions.

------------------------------------------------------------------------

# 16. Agent coordination and task ownership

For multi-agent implementation, use the following ownership boundaries
to reduce conflicting edits:

  -----------------------------------------------------------------------
  Agent                   Scope                   Must not change without
                                                  coordination
  ----------------------- ----------------------- -----------------------
  Agent A --- Fabric      `blockchain/` network,  Backend API contract
                          identities, channel,    
                          chaincode               

  Agent B --- Backend     `backend/`, `database/` Chaincode transaction
                                                  semantics

  Agent C --- Frontend    `frontend/`             API response contract

  Agent D --- Security    `tests/security/`,      Production network
                          `docs/security/`        configuration

  Integrator              root Compose, README,   Shared interfaces
                          API contract,           without notifying
                          end-to-end acceptance   owners
  -----------------------------------------------------------------------

Recommended sequence: 1. Integrator freezes transaction names, data
schema and API contract. 2. Fabric agent implements chaincode interface
and publishes a transaction matrix. 3. Backend agent integrates through
Fabric Gateway. 4. Frontend agent integrates against the documented REST
API. 5. Security agent writes tests against stable endpoints and
transaction names. 6. Integrator runs the full acceptance checklist.

Do not ask all agents to independently invent schemas or transaction
names.

------------------------------------------------------------------------

# 17. Important technical cautions

1.  **Fabric is not a database replacement for every application
    concern.** Use PostgreSQL for accounts, sessions, UI metadata and
    test-run metadata. Use Fabric for the shared, auditable supply-chain
    state.
2.  **Blockchain does not prove physical truth.** It proves that a
    particular identity submitted/endorsed a record and that the ledger
    preserves the accepted history. Independent inspection and trusted
    data capture remain necessary.
3.  **A single Docker host is not a decentralized production
    deployment.** Separate organizations logically and
    cryptographically, but document host co-location as a lab
    limitation.
4.  **Raft is crash fault tolerant, not Byzantine fault tolerant.** Do
    not claim it tolerates malicious orderers.
5.  **Endorsement is not the same as business authorization.** Implement
    both.
6.  **Private Data Collection does not encrypt every application field
    automatically.** Define collection membership, dissemination, purge
    and public projection carefully.
7.  **Fabric does not automatically prevent replay at the business
    level.** Implement event IDs/idempotency and test them.
8.  **Do not edit committed ledger history.** Use append-only correction
    events.
9.  **Do not expose Fabric admin operations to ordinary application
    users.**
10. **Do not use `latest` image tags.** Pin versions and record them in
    the report.
11. **Do not make insecure configuration the default.** Baseline
    weaknesses must be explicit, isolated and reversible.
12. **Do not report benchmark numbers without environment details.**
    Record CPU, RAM, Docker version, Fabric version, peer/orderer
    topology, transaction mix and test duration.

------------------------------------------------------------------------

# 18. First command sequence expected from a new developer

The exact commands may vary by OS and scripts implemented, but README
must provide a tested sequence equivalent to:

``` bash
# 1. Clone and enter repository
git clone <repository-url>
cd yen-sao-blockchain

# 2. Create local environment file
cp .env.example .env

# 3. Validate Docker Compose
docker compose config

# 4. Start database and application foundation
docker compose up -d postgres backend

# 5. Start Fabric network
./blockchain/network/scripts/up.sh

# 6. Create channel and deploy chaincode
./blockchain/network/scripts/deploy.sh

# 7. Initialize demo users/data
npm run seed --workspace backend

# 8. Start full application
docker compose up -d --build

# 9. Verify services
./blockchain/network/scripts/health-check.sh

# 10. Run tests
npm test
npm run test:integration
npm run test:security
```

If npm workspaces are not used, replace the seed command with the actual
backend script and document it consistently.

The developer must be able to open the frontend URL, log in using
documented demo credentials, create a harvest batch, complete the
lifecycle, and view its trace history.

------------------------------------------------------------------------

# 19. Final instruction to implementation agents

Implement the smallest complete, real, demonstrable system first.
Prioritize a correct Fabric network, chaincode authorization,
transaction lifecycle, and repeatable security tests over visual polish
or excessive microservice decomposition.

At every phase: - follow this specification; - keep the repository
runnable; - test before declaring completion; - document deviations; -
preserve secrets; - never replace Fabric with an in-memory or PostgreSQL
simulation.

**The final deliverable is a runnable blockchain supply-chain prototype
plus a reproducible security testing laboratory, not merely a frontend
demo or architecture document.**
