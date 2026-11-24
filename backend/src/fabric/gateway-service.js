"use strict";

const fs = require("node:fs/promises");
const { createPrivateKey } = require("node:crypto");
const grpc = require("@grpc/grpc-js");
const { connect, signers } = require("@hyperledger/fabric-gateway");

const CHANNEL_NAME = process.env.FABRIC_CHANNEL_NAME || "supplychannel";
const CHAINCODE_NAME = process.env.FABRIC_CHAINCODE_NAME || "yen-sao-contract";

function waitForReady(client, timeoutMs) {
  return new Promise((resolve, reject) => {
    client.waitForReady(Date.now() + timeoutMs, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function encodeArguments(args) {
  return args.map((argument) => (
    typeof argument === "string" ? argument : JSON.stringify(argument)
  ));
}

class FabricGatewayService {
  constructor({ identityResolver, timeoutMs = 5000 }) {
    this.identityResolver = identityResolver;
    this.timeoutMs = timeoutMs;
  }

  createClient(endpoint, rootCertificate) {
    const credentials = grpc.credentials.createSsl(rootCertificate);
    return new grpc.Client(endpoint, credentials);
  }

  async withContract(user, callback) {
    const identity = await this.identityResolver.resolve(user);
    const endpoint = this.identityResolver.peerConfigurations()
      .find((peer) => peer.mspId === identity.mspId);
    const client = this.createClient(endpoint.endpoint, identity.tlsRootCertificate);
    const gateway = connect({
      client,
      identity: {
        mspId: identity.mspId,
        credentials: identity.certificate
      },
      signer: signers.newPrivateKeySigner(identity.privateKey),
      discovery: { enabled: true, asLocalhost: false }
    });

    try {
      const contract = gateway.getNetwork(CHANNEL_NAME).getContract(CHAINCODE_NAME);
      return await callback(contract);
    } finally {
      gateway.close();
      client.close();
    }
  }

  async evaluate(user, transactionName, ...args) {
    return this.withContract(user, async (contract) => {
      const result = await contract.evaluateTransaction(transactionName, ...encodeArguments(args));
      return Buffer.from(result).toString("utf8");
    });
  }

  async submit(user, transactionName, ...args) {
    return this.withContract(user, async (contract) => {
      const result = await contract.submitTransaction(transactionName, ...encodeArguments(args));
      return Buffer.from(result).toString("utf8");
    });
  }

  async submitTransient(user, transactionName, args, transientData) {
    return this.withContract(user, async (contract) => {
      const result = await contract.submit(transactionName, {
        arguments: encodeArguments(args),
        transientData
      });
      return Buffer.from(result).toString("utf8");
    });
  }

  async checkReady() {
    const peers = this.identityResolver.peerConfigurations();
    await Promise.all(peers.map(async (peer) => {
      const rootCertificate = await fs.readFile(peer.tlsRootCertificate);
      const client = this.createClient(peer.endpoint, rootCertificate);
      try {
        await waitForReady(client, this.timeoutMs);
      } finally {
        client.close();
      }
    }));
  }
}

module.exports = { FabricGatewayService, encodeArguments, waitForReady };
