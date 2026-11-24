"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FabricGatewayService } = require("../src/fabric/gateway-service");

test("Fabric Gateway decodes byte-array results and keeps transient data separate", async () => {
  const expected = '{"batchId":"YEN-TEST-03"}';
  const response = new Uint8Array(Buffer.from(expected, "utf8"));
  const service = new FabricGatewayService({ identityResolver: {} });
  let transientOptions;
  service.withContract = async (_user, callback) => callback({
    evaluateTransaction: async () => response,
    submitTransaction: async () => response,
    submit: async (_transactionName, options) => {
      transientOptions = options;
      return response;
    }
  });

  assert.equal(await service.evaluate({}, "GetBatch", "YEN-TEST-03"), expected);
  assert.equal(await service.submit({}, "CreateHarvestBatch", { batchId: "YEN-TEST-03" }), expected);
  assert.equal(await service.submitTransient(
    {},
    "StorePrivateCommercialTerms",
    [{ batchId: "YEN-TEST-03", eventId: "EVENT-03" }],
    { privateTerms: '{"commercialPrice":125}' }
  ), expected);
  assert.deepEqual(transientOptions, {
    arguments: ['{"batchId":"YEN-TEST-03","eventId":"EVENT-03"}'],
    transientData: { privateTerms: '{"commercialPrice":125}' }
  });
});
