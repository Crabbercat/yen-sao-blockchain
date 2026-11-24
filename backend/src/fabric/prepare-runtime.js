"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { readIdentityFiles } = require("./identity-resolver");

const IDENTITIES = Object.freeze([
  {
    name: "harvest.operator",
    source: "blockchain/organizations/ca-clients/harvest/OrgHarvest/users/harvest.operator"
  },
  {
    name: "processing.operator",
    source: "blockchain/organizations/ca-clients/processing/OrgProcessing/users/processing.operator"
  },
  {
    name: "quality.inspector",
    source: "blockchain/organizations/ca-clients/processing/OrgProcessing/users/quality.inspector"
  },
  {
    name: "distributor.operator",
    source: "blockchain/organizations/ca-clients/distribution/OrgDistribution/users/distributor.operator"
  }
]);

const TLS_CERTIFICATES = Object.freeze([
  {
    name: "harvest",
    source: "blockchain/organizations/crypto-config/peerOrganizations/org-harvest.example.com/peers/peer0.org-harvest.example.com/tls/ca.crt"
  },
  {
    name: "processing",
    source: "blockchain/organizations/crypto-config/peerOrganizations/org-processing.example.com/peers/peer0.org-processing.example.com/tls/ca.crt"
  },
  {
    name: "distribution",
    source: "blockchain/organizations/crypto-config/peerOrganizations/org-distribution.example.com/peers/peer0.org-distribution.example.com/tls/ca.crt"
  }
]);

async function prepareBackendRuntime(repositoryRoot = path.resolve(__dirname, "../../../")) {
  const runtimeRoot = path.join(repositoryRoot, "backend", "fabric-runtime");

  for (const identity of IDENTITIES) {
    const sourceDirectory = path.join(repositoryRoot, identity.source);
    const { certificate, privateKey } = await readIdentityFiles(sourceDirectory);
    const mspDirectory = path.join(runtimeRoot, "identities", identity.name, "msp");
    const certificateDirectory = path.join(mspDirectory, "signcerts");
    const keyDirectory = path.join(mspDirectory, "keystore");
    const certificatePath = path.join(certificateDirectory, "cert.pem");
    const keyPath = path.join(keyDirectory, "key_sk");

    await fs.mkdir(certificateDirectory, { recursive: true, mode: 0o700 });
    await fs.mkdir(keyDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(certificatePath, certificate, { mode: 0o600 });
    await fs.writeFile(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  }

  for (const certificate of TLS_CERTIFICATES) {
    const sourcePath = path.join(repositoryRoot, certificate.source);
    const destinationDirectory = path.join(runtimeRoot, "tls", certificate.name);
    await fs.mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
    await fs.copyFile(sourcePath, path.join(destinationDirectory, "ca.crt"));
  }
}

if (require.main === module) {
  prepareBackendRuntime()
    .then(() => console.log(JSON.stringify({ event: "backend_fabric_runtime_prepared" })))
    .catch((error) => {
      console.error(JSON.stringify({
        event: "backend_fabric_runtime_prepare_failed",
        message: error.message,
        code: error.code || "UNKNOWN"
      }));
      process.exitCode = 1;
    });
}

module.exports = { prepareBackendRuntime };
