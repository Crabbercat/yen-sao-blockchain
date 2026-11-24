'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { TraceabilityContract } = require('../lib/traceability-contract');

class MockStub {
  constructor() {
    this.state = new Map();
    this.privateState = new Map();
    this.transientData = new Map();
    this.txCounter = 0;
  }

  getTransient() {
    return this.transientData;
  }

  async getState(key) {
    return this.state.get(key) || Buffer.alloc(0);
  }

  async getStateByRange(startKey, endKey) {
    const entries = Array.from(this.state.entries())
      .filter(([key]) => key >= startKey && key < endKey)
      .sort(([left], [right]) => left.localeCompare(right));
    let index = 0;
    return {
      next: async () => {
        if (index >= entries.length) return { done: true };
        const [key, value] = entries[index];
        index += 1;
        return { done: false, value: { key, value } };
      },
      close: async () => {},
    };
  }

  async putState(key, value) {
    this.state.set(key, Buffer.from(value));
  }

  async getPrivateData(collection, key) {
    return this.privateState.get(`${collection}:${key}`) || Buffer.alloc(0);
  }

  async putPrivateData(collection, key, value) {
    this.privateState.set(`${collection}:${key}`, Buffer.from(value));
  }

  createCompositeKey(type, attributes) {
    return `\u0000${type}\u0000${attributes.join('\u0000')}\u0000`;
  }

  async getStateByPartialCompositeKey(type, attributes) {
    const prefix = this.createCompositeKey(type, attributes).slice(0, -1);
    const entries = Array.from(this.state.entries())
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right));
    let index = 0;
    return {
      next: async () => {
        if (index >= entries.length) return { done: true };
        const [key, value] = entries[index];
        index += 1;
        return { done: false, value: { key, value } };
      },
      close: async () => {},
    };
  }

  getTxTimestamp() {
    const seconds = 1_800_000_000 + this.txCounter;
    return {
      getSeconds: () => ({ toString: () => String(seconds) }),
      getNanos: () => 0,
    };
  }

  getTxID() {
    this.txCounter += 1;
    return `tx-${this.txCounter}`;
  }
}

function context(stub, mspId, role, canWrite = 'true') {
  const org = {
    OrgHarvestMSP: 'OrgHarvest',
    OrgProcessingMSP: 'OrgProcessing',
    OrgDistributionMSP: 'OrgDistribution',
  }[mspId];
  return {
    stub,
    clientIdentity: {
      getMSPID: () => mspId,
      getAttributeValue: (name) => ({
        org,
        role,
        canWrite,
        'hf.EnrollmentID': `${role}.test`,
      })[name],
    },
  };
}

function harvestInput(overrides = {}) {
  return {
    batchId: 'YEN-2026-0001',
    eventId: 'event-harvest-1',
    species: 'Swiftlet',
    harvestLocation: 'Cu Lao Cham, Quang Nam, Vietnam',
    harvestedAt: '2026-11-01T02:00:00.000Z',
    quantity: 5.5,
    unit: 'kg',
    ...overrides,
  };
}

test('creates a harvest batch and makes same-event retries idempotent', async () => {
  const contract = new TraceabilityContract();
  const stub = new MockStub();
  const ctx = context(stub, 'OrgHarvestMSP', 'harvest_operator');
  const input = harvestInput();

  const first = await contract.CreateHarvestBatch(ctx, JSON.stringify(input));
  const eventCount = Array.from(stub.state.keys()).filter((key) => key.startsWith('\u0000TraceEvent')).length;
  const retry = await contract.CreateHarvestBatch(ctx, JSON.stringify(input));

  assert.equal(retry, first);
  assert.equal(eventCount, 1);
  assert.equal(JSON.parse(await contract.GetBatch(ctx, input.batchId)).status, 'HARVESTED');
});

test('rejects spoofed roles, negative quantities and conflicting idempotency keys', async () => {
  const contract = new TraceabilityContract();
  const stub = new MockStub();

  await assert.rejects(
    contract.CreateHarvestBatch(context(stub, 'OrgProcessingMSP', 'processing_operator'), JSON.stringify(harvestInput())),
    /FORBIDDEN/,
  );
  await assert.rejects(
    contract.CreateHarvestBatch(context(stub, 'OrgHarvestMSP', 'harvest_operator'), JSON.stringify(harvestInput({ quantity: -1 }))),
    /INVALID_ARGUMENT/,
  );
  await contract.CreateHarvestBatch(context(stub, 'OrgHarvestMSP', 'harvest_operator'), JSON.stringify(harvestInput()));
  await assert.rejects(
    contract.CreateHarvestBatch(context(stub, 'OrgHarvestMSP', 'harvest_operator'), JSON.stringify(harvestInput({ quantity: 4 }))),
    /IDEMPOTENCY_CONFLICT/,
  );
  assert.equal(stub.state.has('batch:YEN-2026-0001'), true);
});

test('enforces handover recipient and preserves lineage and quantity limits', async () => {
  const contract = new TraceabilityContract();
  const stub = new MockStub();
  const harvest = context(stub, 'OrgHarvestMSP', 'harvest_operator');
  const processing = context(stub, 'OrgProcessingMSP', 'processing_operator');

  await contract.CreateHarvestBatch(harvest, JSON.stringify(harvestInput()));
  await contract.CreateHandover(harvest, JSON.stringify({
    batchId: 'YEN-2026-0001',
    recipientMsp: 'OrgProcessingMSP',
    eventId: 'event-handover-1',
  }));
  await assert.rejects(
    contract.AcceptHandover(context(stub, 'OrgDistributionMSP', 'distributor'), JSON.stringify({
      batchId: 'YEN-2026-0001',
      eventId: 'event-handover-2',
    })),
    /FORBIDDEN/,
  );
  await contract.AcceptHandover(processing, JSON.stringify({
    batchId: 'YEN-2026-0001',
    eventId: 'event-handover-2',
  }));

  await assert.rejects(
    contract.CreateDerivedBatch(processing, JSON.stringify({
      batchId: 'YEN-2026-0001-A',
      eventId: 'event-derived-invalid',
      quantity: 1,
      unit: 'kg',
      inputBatches: [{ batchId: 'YEN-2026-0001', quantityUsed: 6, unit: 'kg' }],
    })),
    /INVALID_QUANTITY/,
  );
  await contract.CreateDerivedBatch(processing, JSON.stringify({
    batchId: 'YEN-2026-0001-A',
    eventId: 'event-derived-1',
    quantity: 0.5,
    unit: 'kg',
    inputBatches: [{ batchId: 'YEN-2026-0001', quantityUsed: 5, unit: 'kg' }],
  }));

  const lineage = JSON.parse(await contract.GetBatchLineage(harvest, 'YEN-2026-0001-A'));
  assert.deepEqual(lineage.edges, ['YEN-2026-0001->YEN-2026-0001-A']);
  assert.equal(JSON.parse(await contract.GetBatch(harvest, 'YEN-2026-0001')).availableQuantity, 0.5);
});

test('runs the lifecycle while keeping PDC values out of the public projection', async () => {
  const contract = new TraceabilityContract();
  const stub = new MockStub();
  const harvest = context(stub, 'OrgHarvestMSP', 'harvest_operator');
  const processing = context(stub, 'OrgProcessingMSP', 'processing_operator');
  const inspector = context(stub, 'OrgProcessingMSP', 'quality_inspector');
  const distributor = context(stub, 'OrgDistributionMSP', 'distributor');
  const certificateHash = 'a'.repeat(64);

  await contract.CreateHarvestBatch(harvest, JSON.stringify(harvestInput()));
  await contract.CreateHandover(harvest, JSON.stringify({
    batchId: 'YEN-2026-0001', recipientMsp: 'OrgProcessingMSP', eventId: 'event-handover-1',
  }));
  await contract.AcceptHandover(processing, JSON.stringify({
    batchId: 'YEN-2026-0001', eventId: 'event-handover-2',
  }));
  await contract.RecordProcessing(processing, JSON.stringify({
    recordId: 'PROC-0001',
    outputBatchId: 'YEN-2026-0001-A',
    inputBatches: [{ batchId: 'YEN-2026-0001', quantityUsed: 5, unit: 'kg' }],
    processType: 'CLEANING_AND_SORTING',
    facilityId: 'PROCESSING-FACILITY-01',
    eventId: 'event-processing-1',
  }));
  await contract.CreateDerivedBatch(processing, JSON.stringify({
    batchId: 'YEN-2026-0001-A',
    quantity: 0.5,
    unit: 'kg',
    inputBatches: [{ batchId: 'YEN-2026-0001', quantityUsed: 5, unit: 'kg' }],
    eventId: 'event-derived-1',
  }));
  await contract.RecordQualityCheck(inspector, JSON.stringify({
    qualityId: 'QC-0001',
    batchId: 'YEN-2026-0001-A',
    result: 'PASS',
    standardCode: 'DEMO-STANDARD-01',
    certificateHash,
    eventId: 'event-quality-1',
  }));
  await contract.PackageBatch(processing, JSON.stringify({
    batchId: 'YEN-2026-0001-A',
    certificateHash,
    eventId: 'event-package-1',
  }));
  const privateInput = {
    commercialPrice: 125,
    contractReference: 'CONTRACT-PRIVATE-01',
    supplierNotes: 'do-not-publish-this-note',
  };
  await assert.rejects(
    contract.StorePrivateCommercialTerms(processing, JSON.stringify({
      batchId: 'YEN-2026-0001-A',
      eventId: 'event-private-1',
      ...privateInput,
    })),
    /transient data/,
  );
  stub.transientData.set('privateTerms', Buffer.from(JSON.stringify(privateInput)));
  await contract.StorePrivateCommercialTerms(processing, JSON.stringify({
    batchId: 'YEN-2026-0001-A',
    eventId: 'event-private-1',
  }));
  await contract.CreateShipment(processing, JSON.stringify({
    shipmentId: 'SHIP-0001',
    batchIds: ['YEN-2026-0001-A'],
    recipientMsp: 'OrgDistributionMSP',
    eventId: 'event-shipment-1',
  }));
  assert.equal(JSON.parse(await contract.GetShipment(distributor, 'SHIP-0001')).status, 'CREATED');
  await assert.rejects(
    contract.GetShipment(harvest, 'SHIP-0001'),
    /FORBIDDEN/,
  );
  await assert.rejects(
    contract.RecordDistribution(distributor, JSON.stringify({
      batchId: 'YEN-2026-0001-A',
      shipmentId: 'SHIP-0001',
      distributionId: 'DIST-0001',
      location: 'Da Nang, Vietnam',
      eventId: 'event-distribution-premature',
    })),
    /INVALID_STATE/,
  );
  await contract.AcceptShipment(distributor, JSON.stringify({
    shipmentId: 'SHIP-0001',
    eventId: 'event-shipment-2',
  }));
  assert.equal(JSON.parse(await contract.GetShipment(distributor, 'SHIP-0001')).status, 'ACCEPTED');
  await contract.RecordDistribution(distributor, JSON.stringify({
    batchId: 'YEN-2026-0001-A',
    shipmentId: 'SHIP-0001',
    distributionId: 'DIST-0001',
    location: 'Da Nang, Vietnam',
    eventId: 'event-distribution-1',
  }));

  const publicTrace = await contract.GetPublicTrace(distributor, 'YEN-2026-0001-A');
  assert.match(publicTrace, /DISTRIBUTED/);
  assert.doesNotMatch(publicTrace, /commercialPrice|CONTRACT-PRIVATE|do-not-publish-this-note/);
  assert.equal(JSON.parse(await contract.GetBatches(distributor)).length, 2);
  assert.equal(JSON.parse(await contract.VerifyDocumentHash(distributor, 'YEN-2026-0001-A', certificateHash)).verified, true);
  assert.equal(JSON.parse(await contract.GetPrivateCommercialTerms(processing, 'YEN-2026-0001-A')).commercialPrice, 125);
  await assert.rejects(
    contract.GetPrivateCommercialTerms(distributor, 'YEN-2026-0001-A'),
    /FORBIDDEN/,
  );
});
