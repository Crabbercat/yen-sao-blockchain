"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createPrivateKey, createPublicKey, X509Certificate } = require("node:crypto");

const IDENTITIES = Object.freeze({
  "harvest.operator": {
    mspId: "OrgHarvestMSP",
    role: "harvest_operator",
    peer: "harvest"
  },
  "processing.operator": {
    mspId: "OrgProcessingMSP",
    role: "processing_operator",
    peer: "processing"
  },
  "quality.inspector": {
    mspId: "OrgProcessingMSP",
    role: "quality_inspector",
    peer: "processing"
  },
  "distributor.operator": {
    mspId: "OrgDistributionMSP",
    role: "distributor",
    peer: "distribution"
  }
});

async function readOnlyFile(directory, extension) {
  const names = (await fs.readdir(directory))
    .filter((name) => name.toLowerCase().endsWith(extension))
    .sort();
  if (names.length === 0) {
    throw new Error(`No ${extension} identity file was found in the configured MSP directory`);
  }
  return fs.readFile(path.join(directory, names[0]));
}

async function readIdentityFiles(identityDirectory) {
  const mspDirectory = path.join(identityDirectory, "msp");
  const [certificate, keyNames] = await Promise.all([
    readOnlyFile(path.join(mspDirectory, "signcerts"), ".pem"),
    fs.readdir(path.join(mspDirectory, "keystore"))
  ]);
  const certificatePublicKey = new X509Certificate(certificate).publicKey
    .export({ format: "der", type: "spki" });

  for (const keyName of keyNames.filter((name) => name.endsWith("_sk")).sort()) {
    const privateKey = createPrivateKey(
      await fs.readFile(path.join(mspDirectory, "keystore", keyName))
    );
    const privateKeyPublicKey = createPublicKey(privateKey)
      .export({ format: "der", type: "spki" });
    if (certificatePublicKey.equals(privateKeyPublicKey)) {
      return { certificate, privateKey };
    }
  }

  throw new Error("No private key matches the enrolled Fabric signing certificate");
}

class IdentityResolver {
  constructor(env = process.env) {
    this.identityRoot = env.FABRIC_IDENTITY_ROOT || "/app/fabric-identities";
    this.tlsRoot = env.FABRIC_TLS_ROOT || "/app/fabric-tls";
  }

  async resolve(user) {
    const identity = IDENTITIES[user.fabric_identity];
    if (
      !identity
      || identity.role !== user.role
      || identity.mspId !== user.organization_msp
    ) {
      throw Object.assign(new Error("The authenticated user has no permitted Fabric identity"), {
        code: "FORBIDDEN"
      });
    }

    const identityDirectory = path.join(this.identityRoot, user.fabric_identity);
    const files = await readIdentityFiles(identityDirectory);
    return {
      ...files,
      ...identity,
      tlsRootCertificate: await fs.readFile(path.join(this.tlsRoot, identity.peer, "ca.crt"))
    };
  }

  peerConfigurations() {
    return [
      {
        mspId: "OrgHarvestMSP",
        endpoint: "peer0.org-harvest.example.com:7051",
        tlsRootCertificate: path.join(this.tlsRoot, "harvest", "ca.crt")
      },
      {
        mspId: "OrgProcessingMSP",
        endpoint: "peer0.org-processing.example.com:8051",
        tlsRootCertificate: path.join(this.tlsRoot, "processing", "ca.crt")
      },
      {
        mspId: "OrgDistributionMSP",
        endpoint: "peer0.org-distribution.example.com:9051",
        tlsRootCertificate: path.join(this.tlsRoot, "distribution", "ca.crt")
      }
    ];
  }
}

module.exports = { IDENTITIES, IdentityResolver, readIdentityFiles };
