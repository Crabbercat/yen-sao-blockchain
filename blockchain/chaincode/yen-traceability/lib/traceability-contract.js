'use strict';

const crypto = require('node:crypto');
const { Contract } = require('fabric-contract-api');

const ORGS = Object.freeze({
  OrgHarvestMSP: { name: 'OrgHarvest', role: 'harvest_operator' },
  OrgProcessingMSP: { name: 'OrgProcessing', role: 'processing_operator' },
  OrgDistributionMSP: { name: 'OrgDistribution', role: 'distributor' },
});
const PRIVATE_COLLECTION = 'collectionPrivateCommercial';
const VALID_UNITS = new Set(['g', 'kg', 'piece']);
const TERMINAL_STATES = new Set(['DISTRIBUTED', 'RECALLED', 'CANCELLED']);

function fail(code, message) {
  throw new Error(`${code}: ${message}`);
}

function parseInput(raw, label = 'input') {
  if (typeof raw !== 'string') {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    fail('INVALID_ARGUMENT', `${label} must be a JSON object`);
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail('INVALID_ARGUMENT', `${label} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    if (error.message.startsWith('INVALID_ARGUMENT:')) throw error;
    fail('INVALID_ARGUMENT', `${label} must be valid JSON`);
  }
}

function requiredText(value, field, maxLength = 256) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    fail('INVALID_ARGUMENT', `${field} is required and must be at most ${maxLength} characters`);
  }
  return value.trim();
}

function validateId(value, field) {
  const id = requiredText(value, field, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    fail('INVALID_ARGUMENT', `${field} contains unsupported characters`);
  }
  return id;
}

function validateQuantity(value, field = 'quantity') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail('INVALID_ARGUMENT', `${field} must be a positive finite number`);
  }
  return value;
}

function validateUnit(value, field = 'unit') {
  if (typeof value !== 'string' || !VALID_UNITS.has(value)) {
    fail('INVALID_ARGUMENT', `${field} must be one of ${Array.from(VALID_UNITS).join(', ')}`);
  }
  return value;
}

function validateHash(value, field = 'sha256') {
  const hash = requiredText(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    fail('INVALID_ARGUMENT', `${field} must be a 64-character SHA-256 hex digest`);
  }
  return hash;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function txTimestamp(ctx) {
  const timestamp = ctx.stub.getTxTimestamp();
  if (
    !timestamp
    || typeof timestamp.getSeconds !== 'function'
    || typeof timestamp.getNanos !== 'function'
  ) {
    fail('INTERNAL_ERROR', 'Fabric transaction timestamp is unavailable');
  }
  const seconds = Number(String(timestamp.getSeconds()));
  const nanos = Number(timestamp.getNanos());
  const milliseconds = seconds * 1000 + nanos / 1e6;
  const date = new Date(milliseconds);
  if (
    !Number.isSafeInteger(seconds)
    || !Number.isInteger(nanos)
    || nanos < 0
    || nanos >= 1e9
    || Number.isNaN(date.getTime())
  ) {
    fail('INTERNAL_ERROR', 'Fabric transaction timestamp is unavailable');
  }
  return date.toISOString();
}

function identity(ctx) {
  const mspId = ctx.clientIdentity.getMSPID();
  return {
    mspId,
    org: ctx.clientIdentity.getAttributeValue('org'),
    role: ctx.clientIdentity.getAttributeValue('role'),
    canWrite: ctx.clientIdentity.getAttributeValue('canWrite'),
    actorId: ctx.clientIdentity.getAttributeValue('hf.EnrollmentID') || `member-${mspId}`,
  };
}

function requireWriteIdentity(ctx, mspId, role) {
  const actor = identity(ctx);
  if (
    actor.mspId !== mspId
    || actor.org !== ORGS[mspId]?.name
    || actor.role !== role
    || actor.canWrite !== 'true'
  ) {
    fail('FORBIDDEN', 'The verified Fabric identity is not authorized for this operation');
  }
  return actor;
}

function requireOrganization(ctx, allowedMspIds) {
  const actor = identity(ctx);
  if (!allowedMspIds.includes(actor.mspId) || actor.org !== ORGS[actor.mspId]?.name) {
    fail('FORBIDDEN', 'The verified Fabric identity is not authorized for this operation');
  }
  return actor;
}

function requireOrganizationWriter(actor) {
  if (actor.role !== ORGS[actor.mspId]?.role || actor.canWrite !== 'true') {
    fail('FORBIDDEN', 'The verified Fabric identity is not authorized for this operation');
  }
}

async function readJson(ctx, key, label) {
  const value = await ctx.stub.getState(key);
  if (!value || value.length === 0) fail('NOT_FOUND', `${label} was not found`);
  try {
    return JSON.parse(value.toString());
  } catch {
    fail('LEDGER_ERROR', `${label} is not valid ledger JSON`);
  }
}

async function readBatch(ctx, batchId) {
  return readJson(ctx, `batch:${validateId(batchId, 'batchId')}`, 'Batch');
}

async function writeJson(ctx, key, value) {
  await ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
}

function transactionEvent(ctx, actor, eventId, batchId, eventType, timestamp, details, relatedBatchIds = [], documentHashes = []) {
  return {
    eventId,
    docType: 'TraceEvent',
    batchId,
    eventType,
    actorMsp: actor.mspId,
    actorId: actor.actorId,
    transactionId: ctx.stub.getTxID(),
    transactionTimestamp: timestamp,
    details,
    relatedBatchIds: [...new Set(relatedBatchIds)].sort(),
    documentHashes: [...new Set(documentHashes)].sort(),
  };
}

async function writeEvents(ctx, events) {
  for (const event of events) {
    const key = ctx.stub.createCompositeKey('TraceEvent', [
      event.batchId,
      event.transactionTimestamp,
      event.eventId,
    ]);
    await writeJson(ctx, key, event);
  }
}

async function submitMutation(ctx, input, operation, authorize, execute) {
  const eventId = validateId(input.eventId, 'eventId');
  const actor = authorize();
  const idempotencyKey = ctx.stub.createCompositeKey('Idempotency', [eventId]);
  const inputHash = digest(stableStringify(input));
  const existing = await ctx.stub.getState(idempotencyKey);
  if (existing && existing.length > 0) {
    const prior = JSON.parse(existing.toString());
    if (prior.operation !== operation || prior.inputHash !== inputHash) {
      fail('IDEMPOTENCY_CONFLICT', 'eventId was already used for a different request');
    }
    return JSON.stringify(prior.result);
  }

  const timestamp = txTimestamp(ctx);
  const outcome = await execute(actor, timestamp);
  await writeEvents(ctx, outcome.events);
  await writeJson(ctx, idempotencyKey, { operation, inputHash, result: outcome.result });
  return JSON.stringify(outcome.result);
}

async function readEvents(ctx, batchId) {
  const iterator = await ctx.stub.getStateByPartialCompositeKey('TraceEvent', [batchId]);
  const events = [];
  try {
    while (true) {
      const item = await iterator.next();
      if (item.done) break;
      events.push(JSON.parse(item.value.value.toString()));
    }
  } finally {
    await iterator.close();
  }
  return events.sort((left, right) =>
    left.transactionTimestamp.localeCompare(right.transactionTimestamp)
    || left.eventId.localeCompare(right.eventId));
}

function publicBatch(batch) {
  const {
    batchId,
    batchType,
    species,
    harvestLocation,
    harvestedAt,
    quantity,
    unit,
    availableQuantity,
    ownerMsp,
    currentOwnerMsp,
    status,
    createdAt,
    documentHashes = [],
    parents = [],
    children = [],
    latestQualityResult,
  } = batch;
  return {
    batchId,
    batchType,
    species,
    harvestLocation,
    harvestedAt,
    quantity,
    unit,
    availableQuantity,
    ownerMsp,
    currentOwnerMsp,
    status,
    createdAt,
    documentHashes,
    parents,
    children,
    latestQualityResult,
  };
}

function publicEvent(event) {
  return {
    eventId: event.eventId,
    batchId: event.batchId,
    eventType: event.eventType,
    actorMsp: event.actorMsp,
    transactionTimestamp: event.transactionTimestamp,
    details: event.details,
    relatedBatchIds: event.relatedBatchIds,
    documentHashes: event.documentHashes,
  };
}

function validateMsp(value, field) {
  if (typeof value !== 'string' || !Object.hasOwn(ORGS, value)) {
    fail('INVALID_ARGUMENT', `${field} is not a supported organization`);
  }
  return value;
}

function requireExistingBatchId(batchId) {
  return validateId(batchId, 'batchId');
}

class TraceabilityContract extends Contract {
  async CreateHarvestBatch(ctx, rawInput) {
    const input = parseInput(rawInput);
    const batchId = validateId(input.batchId, 'batchId');
    const quantity = validateQuantity(input.quantity);
    const unit = validateUnit(input.unit);
    const species = requiredText(input.species, 'species', 100);
    const harvestLocation = requiredText(input.harvestLocation, 'harvestLocation', 256);
    const harvestedAt = requiredText(input.harvestedAt, 'harvestedAt', 40);
    if (Number.isNaN(Date.parse(harvestedAt))) fail('INVALID_ARGUMENT', 'harvestedAt must be an ISO 8601 timestamp');

    return submitMutation(ctx, input, 'CreateHarvestBatch',
      () => requireWriteIdentity(ctx, 'OrgHarvestMSP', 'harvest_operator'),
      async (actor, timestamp) => {
        const key = `batch:${batchId}`;
        const prior = await ctx.stub.getState(key);
        if (prior && prior.length > 0) fail('ALREADY_EXISTS', 'batchId already exists');
        const batch = {
          docType: 'HarvestBatch',
          batchId,
          batchType: 'RAW',
          species,
          harvestLocation,
          harvestedAt,
          quantity,
          availableQuantity: quantity,
          unit,
          ownerMsp: actor.mspId,
          currentOwnerMsp: actor.mspId,
          status: 'HARVESTED',
          createdBy: actor.actorId,
          createdAt: timestamp,
          documentHashes: [],
          parents: [],
          children: [],
        };
        await writeJson(ctx, key, batch);
        return {
          result: batch,
          events: [transactionEvent(ctx, actor, input.eventId, batchId, 'HarvestBatchCreated', timestamp, {
            batchType: batch.batchType,
            quantity,
            unit,
            harvestLocation,
          })],
        };
      });
  }

  async GetBatch(ctx, batchId) {
    const batch = await readBatch(ctx, batchId);
    const actor = identity(ctx);
    const isMember = Object.hasOwn(ORGS, actor.mspId) && actor.org === ORGS[actor.mspId].name;
    return JSON.stringify(isMember ? batch : publicBatch(batch));
  }

  async GetBatches(ctx) {
    const actor = identity(ctx);
    const isMember = Object.hasOwn(ORGS, actor.mspId) && actor.org === ORGS[actor.mspId].name;
    const iterator = await ctx.stub.getStateByRange('batch:', 'batch;');
    const batches = [];
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) break;
        const batch = JSON.parse(result.value.value.toString());
        batches.push(isMember ? batch : publicBatch(batch));
      }
    } finally {
      await iterator.close();
    }
    batches.sort((left, right) => left.batchId.localeCompare(right.batchId));
    return JSON.stringify(batches);
  }

  async CreateHandover(ctx, rawInput) {
    const input = parseInput(rawInput);
    const batchId = validateId(input.batchId, 'batchId');
    const recipientMsp = validateMsp(input.recipientMsp, 'recipientMsp');

    return submitMutation(ctx, input, 'CreateHandover',
      () => requireOrganization(ctx, Object.keys(ORGS)),
      async (actor, timestamp) => {
        requireOrganizationWriter(actor);
        const batch = await readBatch(ctx, batchId);
        if (batch.currentOwnerMsp !== actor.mspId) fail('FORBIDDEN', 'Only the current owner may initiate a handover');
        if (recipientMsp === actor.mspId || TERMINAL_STATES.has(batch.status) || batch.pendingTransfer) {
          fail('INVALID_STATE', 'Batch cannot be handed over in its current state');
        }
        if (actor.mspId !== 'OrgHarvestMSP' || recipientMsp !== 'OrgProcessingMSP') {
          fail('INVALID_STATE', 'Raw batch handovers must transfer from OrgHarvest to OrgProcessing');
        }
        if (batch.availableQuantity <= 0) fail('INVALID_STATE', 'Batch has no available quantity');
        batch.pendingTransfer = { recipientMsp, eventId: input.eventId, createdAt: timestamp };
        batch.status = 'HANDED_OVER';
        await writeJson(ctx, `batch:${batchId}`, batch);
        return {
          result: batch,
          events: [transactionEvent(ctx, actor, input.eventId, batchId, 'HandoverCreated', timestamp, {
            recipientMsp,
          })],
        };
      });
  }

  async AcceptHandover(ctx, rawInput) {
    const input = parseInput(rawInput);
    const batchId = validateId(input.batchId, 'batchId');

    return submitMutation(ctx, input, 'AcceptHandover',
      () => requireOrganization(ctx, Object.keys(ORGS)),
      async (actor, timestamp) => {
        const batch = await readBatch(ctx, batchId);
        requireOrganizationWriter(actor);
        if (batch.pendingTransfer?.recipientMsp !== actor.mspId) {
          fail('FORBIDDEN', 'Only the intended recipient may accept this handover');
        }
        const previousOwnerMsp = batch.currentOwnerMsp;
        batch.currentOwnerMsp = actor.mspId;
        batch.status = 'RECEIVED';
        delete batch.pendingTransfer;
        await writeJson(ctx, `batch:${batchId}`, batch);
        return {
          result: batch,
          events: [transactionEvent(ctx, actor, input.eventId, batchId, 'HandoverAccepted', timestamp, {
            previousOwnerMsp,
            currentOwnerMsp: actor.mspId,
          })],
        };
      });
  }

  async RecordProcessing(ctx, rawInput) {
    const input = parseInput(rawInput);
    const recordId = validateId(input.recordId, 'recordId');
    const outputBatchId = validateId(input.outputBatchId, 'outputBatchId');
    const processType = requiredText(input.processType, 'processType', 100);
    const facilityId = requiredText(input.facilityId, 'facilityId', 100);
    if (!Array.isArray(input.inputBatches) || input.inputBatches.length === 0) {
      fail('INVALID_ARGUMENT', 'inputBatches must contain at least one source batch');
    }

    return submitMutation(ctx, input, 'RecordProcessing',
      () => requireWriteIdentity(ctx, 'OrgProcessingMSP', 'processing_operator'),
      async (actor, timestamp) => {
        const recordKey = `processing:${recordId}`;
        const prior = await ctx.stub.getState(recordKey);
        if (prior && prior.length > 0) fail('ALREADY_EXISTS', 'recordId already exists');
        const batchIds = input.inputBatches.map((item) => validateId(item.batchId, 'inputBatches.batchId'));
        if (new Set(batchIds).size !== batchIds.length) fail('INVALID_ARGUMENT', 'inputBatches must not contain duplicates');
        const sourceBatches = [];
        for (const batchId of batchIds) {
          const batch = await readBatch(ctx, batchId);
          if (batch.currentOwnerMsp !== actor.mspId || !['RECEIVED', 'PROCESSING'].includes(batch.status)) {
            fail('INVALID_STATE', 'Source batch is not available for processing');
          }
          sourceBatches.push(batch);
        }
        const record = {
          docType: 'ProcessingRecord',
          recordId,
          outputBatchId,
          inputBatches: input.inputBatches.map((item, index) => ({
            batchId: batchIds[index],
            quantityUsed: validateQuantity(item.quantityUsed, 'quantityUsed'),
            unit: validateUnit(item.unit, 'inputBatches.unit'),
          })),
          processType,
          facilityId,
          notes: typeof input.notes === 'string' ? input.notes.slice(0, 1000) : '',
          createdByMsp: actor.mspId,
          createdAt: timestamp,
        };
        for (let index = 0; index < record.inputBatches.length; index += 1) {
          const item = record.inputBatches[index];
          const batch = sourceBatches[index];
          if (batch.availableQuantity < item.quantityUsed || batch.unit !== item.unit) {
            fail('INVALID_QUANTITY', 'Processing input exceeds the available batch quantity or uses a different unit');
          }
        }
        for (const batch of sourceBatches) {
          batch.status = 'PROCESSING';
          await writeJson(ctx, `batch:${batch.batchId}`, batch);
        }
        await writeJson(ctx, recordKey, record);
        return {
          result: record,
          events: [...new Set([...batchIds, outputBatchId])].map((batchId) => transactionEvent(ctx, actor, input.eventId, batchId, 'ProcessingRecorded', timestamp, {
            recordId,
            outputBatchId,
            processType,
            facilityId,
          }, [outputBatchId])),
        };
      });
  }

  async CreateDerivedBatch(ctx, rawInput) {
    const input = parseInput(rawInput);
    const batchId = validateId(input.batchId, 'batchId');
    const quantity = validateQuantity(input.quantity);
    const unit = validateUnit(input.unit);
    if (!Array.isArray(input.inputBatches) || input.inputBatches.length === 0) {
      fail('INVALID_ARGUMENT', 'inputBatches must contain at least one source batch');
    }

    return submitMutation(ctx, input, 'CreateDerivedBatch',
      () => requireWriteIdentity(ctx, 'OrgProcessingMSP', 'processing_operator'),
      async (actor, timestamp) => {
        const key = `batch:${batchId}`;
        const prior = await ctx.stub.getState(key);
        if (prior && prior.length > 0) fail('ALREADY_EXISTS', 'batchId already exists');
        const parentInputs = input.inputBatches.map((item) => ({
          batchId: validateId(item.batchId, 'inputBatches.batchId'),
          quantityUsed: validateQuantity(item.quantityUsed, 'quantityUsed'),
          unit: validateUnit(item.unit, 'inputBatches.unit'),
        }));
        const parentIds = parentInputs.map((item) => item.batchId);
        if (new Set(parentIds).size !== parentIds.length || parentIds.includes(batchId)) {
          fail('INVALID_ARGUMENT', 'inputBatches must contain distinct parent batch IDs');
        }
        const parents = [];
        const parentUpdates = [];
        for (const item of parentInputs) {
          const parent = await readBatch(ctx, item.batchId);
          if (parent.currentOwnerMsp !== actor.mspId || !['RECEIVED', 'PROCESSING'].includes(parent.status)) {
            fail('INVALID_STATE', 'Source batch is not available for processing');
          }
          if (item.unit !== parent.unit || item.quantityUsed > parent.availableQuantity) {
            fail('INVALID_QUANTITY', 'Consumed quantity exceeds the available quantity or uses a different unit');
          }
          parent.availableQuantity -= item.quantityUsed;
          parent.status = 'PROCESSING';
          parent.children = [...new Set([...(parent.children || []), batchId])].sort();
          parentUpdates.push(parent);
          parents.push({ batchId: parent.batchId, quantityUsed: item.quantityUsed, unit: item.unit });
        }
        const child = {
          docType: 'ProductBatch',
          batchId,
          batchType: requiredText(input.batchType || 'PRODUCT', 'batchType', 40),
          species: typeof input.species === 'string' ? input.species.slice(0, 100) : '',
          quantity,
          availableQuantity: quantity,
          unit,
          ownerMsp: actor.mspId,
          currentOwnerMsp: actor.mspId,
          status: 'PROCESSING',
          createdBy: actor.actorId,
          createdAt: timestamp,
          documentHashes: [],
          parents,
          children: [],
        };
        for (const parent of parentUpdates) {
          await writeJson(ctx, `batch:${parent.batchId}`, parent);
        }
        await writeJson(ctx, key, child);
        const related = [batchId, ...parentIds];
        return {
          result: child,
          events: related.map((relatedId) => transactionEvent(ctx, actor, input.eventId, relatedId, 'DerivedBatchCreated', timestamp, {
            outputBatchId: batchId,
            parentBatchIds: parentIds,
          }, related)),
        };
      });
  }

  async RecordQualityCheck(ctx, rawInput) {
    const input = parseInput(rawInput);
    const qualityId = validateId(input.qualityId, 'qualityId');
    const batchId = validateId(input.batchId, 'batchId');
    const result = requiredText(input.result, 'result', 10).toUpperCase();
    if (!['PASS', 'FAIL'].includes(result)) fail('INVALID_ARGUMENT', 'result must be PASS or FAIL');
    const standardCode = requiredText(input.standardCode, 'standardCode', 100);
    const certificateHash = input.certificateHash ? validateHash(input.certificateHash, 'certificateHash') : null;
    const documentRef = typeof input.documentRef === 'string' ? input.documentRef.slice(0, 256) : '';

    return submitMutation(ctx, input, 'RecordQualityCheck',
      () => requireWriteIdentity(ctx, 'OrgProcessingMSP', 'quality_inspector'),
      async (actor, timestamp) => {
        const key = `quality:${qualityId}`;
        const prior = await ctx.stub.getState(key);
        if (prior && prior.length > 0) fail('ALREADY_EXISTS', 'qualityId already exists');
        const batch = await readBatch(ctx, batchId);
        if (batch.currentOwnerMsp !== actor.mspId || !['PROCESSING', 'QUALITY_CHECKED'].includes(batch.status)) {
          fail('INVALID_STATE', 'Batch is not available for a quality check');
        }
        const record = {
          docType: 'QualityRecord',
          qualityId,
          batchId,
          result,
          standardCode,
          certificateHash,
          documentRef,
          inspectorMsp: actor.mspId,
          createdAt: timestamp,
        };
        batch.latestQualityResult = result;
        batch.latestQualityId = qualityId;
        batch.status = 'QUALITY_CHECKED';
        if (certificateHash) batch.documentHashes = [...new Set([...(batch.documentHashes || []), certificateHash])].sort();
        await writeJson(ctx, key, record);
        await writeJson(ctx, `batch:${batchId}`, batch);
        return {
          result: record,
          events: [transactionEvent(ctx, actor, input.eventId, batchId, 'QualityCheckRecorded', timestamp, {
            qualityId,
            result,
            standardCode,
          }, [], certificateHash ? [certificateHash] : [])],
        };
      });
  }

  async PackageBatch(ctx, rawInput) {
    const input = parseInput(rawInput);
    const batchId = validateId(input.batchId, 'batchId');
    const certificateHash = validateHash(input.certificateHash, 'certificateHash');

    return submitMutation(ctx, input, 'PackageBatch',
      () => requireWriteIdentity(ctx, 'OrgProcessingMSP', 'processing_operator'),
      async (actor, timestamp) => {
        const batch = await readBatch(ctx, batchId);
        if (batch.currentOwnerMsp !== actor.mspId || batch.status !== 'QUALITY_CHECKED' || batch.latestQualityResult !== 'PASS') {
          fail('INVALID_STATE', 'Only a quality-approved batch can be packaged');
        }
        batch.status = 'PACKAGED';
        batch.documentHashes = [...new Set([...(batch.documentHashes || []), certificateHash])].sort();
        batch.packagedAt = timestamp;
        await writeJson(ctx, `batch:${batchId}`, batch);
        return {
          result: batch,
          events: [transactionEvent(ctx, actor, input.eventId, batchId, 'BatchPackaged', timestamp, {
            certificateHash,
          }, [], [certificateHash])],
        };
      });
  }

  async CreateShipment(ctx, rawInput) {
    const input = parseInput(rawInput);
    const shipmentId = validateId(input.shipmentId, 'shipmentId');
    const recipientMsp = validateMsp(input.toMsp || input.recipientMsp, 'toMsp');
    if (!Array.isArray(input.batchIds) || input.batchIds.length === 0) {
      fail('INVALID_ARGUMENT', 'batchIds must contain at least one batch');
    }

    return submitMutation(ctx, input, 'CreateShipment',
      () => requireOrganization(ctx, Object.keys(ORGS)),
      async (actor, timestamp) => {
        requireOrganizationWriter(actor);
        if (actor.mspId !== 'OrgProcessingMSP' || recipientMsp !== 'OrgDistributionMSP') {
          fail('INVALID_STATE', 'Shipments must transfer packaged products from OrgProcessing to OrgDistribution');
        }
        const shipmentKey = `shipment:${shipmentId}`;
        const prior = await ctx.stub.getState(shipmentKey);
        if (prior && prior.length > 0) fail('ALREADY_EXISTS', 'shipmentId already exists');
        const batchIds = input.batchIds.map((id) => validateId(id, 'batchIds'));
        if (new Set(batchIds).size !== batchIds.length || recipientMsp === actor.mspId) {
          fail('INVALID_ARGUMENT', 'batchIds must be unique and recipientMsp must differ from the sender');
        }
        const batches = [];
        for (const batchId of batchIds) {
          const batch = await readBatch(ctx, batchId);
          if (batch.currentOwnerMsp !== actor.mspId || batch.status !== 'PACKAGED') {
            fail('INVALID_STATE', 'Every shipment batch must be packaged and owned by the sender');
          }
          batch.status = 'IN_TRANSIT';
          batch.pendingShipmentId = shipmentId;
          await writeJson(ctx, `batch:${batchId}`, batch);
          batches.push(batch);
        }
        const shipment = {
          docType: 'Shipment',
          shipmentId,
          batchIds,
          fromMsp: actor.mspId,
          toMsp: recipientMsp,
          status: 'CREATED',
          createdAt: timestamp,
        };
        await writeJson(ctx, shipmentKey, shipment);
        return {
          result: shipment,
          events: batchIds.map((batchId) => transactionEvent(ctx, actor, input.eventId, batchId, 'ShipmentCreated', timestamp, {
            shipmentId,
            fromMsp: actor.mspId,
            toMsp: recipientMsp,
          }, batchIds)),
        };
      });
  }

  async GetShipment(ctx, shipmentId) {
    const id = validateId(shipmentId, 'shipmentId');
    requireOrganization(ctx, ['OrgProcessingMSP', 'OrgDistributionMSP']);
    return JSON.stringify(await readJson(ctx, `shipment:${id}`, 'Shipment'));
  }

  async AcceptShipment(ctx, rawInput) {
    const input = parseInput(rawInput);
    const shipmentId = validateId(input.shipmentId, 'shipmentId');

    return submitMutation(ctx, input, 'AcceptShipment',
      () => requireOrganization(ctx, Object.keys(ORGS)),
      async (actor, timestamp) => {
        const shipmentKey = `shipment:${shipmentId}`;
        const shipment = await readJson(ctx, shipmentKey, 'Shipment');
        requireOrganizationWriter(actor);
        if (shipment.toMsp !== actor.mspId || shipment.status !== 'CREATED') {
          fail('FORBIDDEN', 'Only the intended recipient may accept this shipment');
        }
        for (const batchId of shipment.batchIds) {
          const batch = await readBatch(ctx, batchId);
          if (
            batch.pendingShipmentId !== shipmentId
            || batch.status !== 'IN_TRANSIT'
            || batch.currentOwnerMsp !== shipment.fromMsp
          ) {
            fail('INVALID_STATE', 'Shipment batch is not in transit');
          }
          batch.currentOwnerMsp = actor.mspId;
          batch.status = 'RECEIVED';
          delete batch.pendingShipmentId;
          await writeJson(ctx, `batch:${batchId}`, batch);
        }
        shipment.status = 'ACCEPTED';
        shipment.acceptedAt = timestamp;
        await writeJson(ctx, shipmentKey, shipment);
        return {
          result: shipment,
          events: shipment.batchIds.map((batchId) => transactionEvent(ctx, actor, input.eventId, batchId, 'ShipmentAccepted', timestamp, {
            shipmentId,
            currentOwnerMsp: actor.mspId,
          }, shipment.batchIds)),
        };
      });
  }

  async RecordDistribution(ctx, rawInput) {
    const input = parseInput(rawInput);
    const batchId = validateId(input.batchId, 'batchId');
    const shipmentId = validateId(input.shipmentId, 'shipmentId');
    const distributionId = validateId(input.distributionId, 'distributionId');
    const location = requiredText(input.location, 'location', 256);

    return submitMutation(ctx, input, 'RecordDistribution',
      () => requireWriteIdentity(ctx, 'OrgDistributionMSP', 'distributor'),
      async (actor, timestamp) => {
        const batch = await readBatch(ctx, batchId);
        const shipment = await readJson(ctx, `shipment:${shipmentId}`, 'Shipment');
        if (
          shipment.toMsp !== actor.mspId
          || shipment.status !== 'ACCEPTED'
          || !shipment.batchIds.includes(batchId)
        ) {
          fail('INVALID_STATE', 'Batch is not part of an accepted shipment for this distributor');
        }
        if (batch.currentOwnerMsp !== actor.mspId || batch.status !== 'RECEIVED') {
          fail('INVALID_STATE', 'Only a received batch owned by OrgDistribution can be distributed');
        }
        batch.status = 'DISTRIBUTED';
        batch.distributedAt = timestamp;
        await writeJson(ctx, `batch:${batchId}`, batch);
        const event = transactionEvent(ctx, actor, input.eventId, batchId, 'DistributionRecorded', timestamp, {
          distributionId,
          location,
          shipmentId,
        });
        return { result: batch, events: [event] };
      });
  }

  async AddCorrectionEvent(ctx, rawInput) {
    const input = parseInput(rawInput);
    const batchId = validateId(input.batchId, 'batchId');
    const referencedEventId = validateId(input.referencedEventId, 'referencedEventId');
    const reason = requiredText(input.reason, 'reason', 500);

    return submitMutation(ctx, input, 'AddCorrectionEvent',
      () => requireOrganization(ctx, Object.keys(ORGS)),
      async (actor, timestamp) => {
        if (actor.canWrite !== 'true' || !['auditor', ORGS[actor.mspId].role].includes(actor.role)) {
          fail('FORBIDDEN', 'The verified Fabric identity is not authorized for this operation');
        }
        const batch = await readBatch(ctx, batchId);
        if (actor.role !== 'auditor' && batch.currentOwnerMsp !== actor.mspId) {
          fail('FORBIDDEN', 'Only an auditor or the current owner may add a correction');
        }
        const history = await readEvents(ctx, batchId);
        if (!history.some((event) => event.eventId === referencedEventId)) {
          fail('NOT_FOUND', 'Referenced event was not found for this batch');
        }
        const event = transactionEvent(ctx, actor, input.eventId, batchId, 'CorrectionAdded', timestamp, {
          referencedEventId,
          reason,
        });
        return { result: event, events: [event] };
      });
  }

  async GetBatchHistory(ctx, batchId) {
    const id = requireExistingBatchId(batchId);
    await readBatch(ctx, id);
    const events = await readEvents(ctx, id);
    const actor = identity(ctx);
    const isMember = Object.hasOwn(ORGS, actor.mspId) && actor.org === ORGS[actor.mspId].name;
    return JSON.stringify(isMember ? events : events.map(publicEvent));
  }

  async GetBatchLineage(ctx, batchId) {
    const rootId = requireExistingBatchId(batchId);
    const pending = [rootId];
    const visited = new Map();
    const edges = new Set();
    while (pending.length > 0) {
      const currentId = pending.shift();
      if (visited.has(currentId)) continue;
      const batch = await readBatch(ctx, currentId);
      visited.set(currentId, publicBatch(batch));
      for (const parent of batch.parents || []) {
        edges.add(`${parent.batchId}->${currentId}`);
        pending.push(parent.batchId);
      }
      for (const childId of batch.children || []) {
        edges.add(`${currentId}->${childId}`);
        pending.push(childId);
      }
    }
    return JSON.stringify({
      rootBatchId: rootId,
      batches: Array.from(visited.values()).sort((left, right) => left.batchId.localeCompare(right.batchId)),
      edges: Array.from(edges).sort(),
    });
  }

  async VerifyDocumentHash(ctx, batchId, rawHash) {
    const id = requireExistingBatchId(batchId);
    const hash = validateHash(rawHash);
    const batch = await readBatch(ctx, id);
    return JSON.stringify({ batchId: id, sha256: hash, verified: (batch.documentHashes || []).includes(hash) });
  }

  async GetPublicTrace(ctx, batchId) {
    const id = requireExistingBatchId(batchId);
    const batch = await readBatch(ctx, id);
    const events = await readEvents(ctx, id);
    return JSON.stringify({
      batch: publicBatch(batch),
      history: events.map(publicEvent),
    });
  }

  async StorePrivateCommercialTerms(ctx, rawInput) {
    const input = parseInput(rawInput);
    if (Object.keys(input).some((key) => !['batchId', 'eventId'].includes(key))) {
      fail('INVALID_ARGUMENT', 'Private terms must be submitted through transient data');
    }
    const batchId = validateId(input.batchId, 'batchId');
    const eventId = validateId(input.eventId, 'eventId');
    const allowed = requireOrganization(ctx, ['OrgHarvestMSP', 'OrgProcessingMSP']);
    const role = ORGS[allowed.mspId].role;
    if (allowed.role !== role || allowed.canWrite !== 'true') {
      fail('FORBIDDEN', 'The verified Fabric identity is not authorized for this operation');
    }
    const transientData = ctx.stub.getTransient();
    const rawTerms = transientData && transientData.get('privateTerms');
    if (!rawTerms || rawTerms.length === 0) {
      fail('INVALID_ARGUMENT', 'Private terms transient data is required');
    }
    const privateInput = parseInput(Buffer.from(rawTerms).toString(), 'privateTerms');
    const batch = await readBatch(ctx, batchId);
    if (batch.currentOwnerMsp !== allowed.mspId) fail('FORBIDDEN', 'Only the current owner may store private terms');
    const terms = {
      commercialPrice: privateInput.commercialPrice === undefined
        ? null
        : validateQuantity(privateInput.commercialPrice, 'commercialPrice'),
      contractReference: typeof privateInput.contractReference === 'string'
        ? privateInput.contractReference.slice(0, 128)
        : '',
      supplierNotes: typeof privateInput.supplierNotes === 'string'
        ? privateInput.supplierNotes.slice(0, 500)
        : '',
    };
    const idempotencyKey = `privateIdempotency:${eventId}`;
    const inputHash = digest(stableStringify({ input, terms }));
    const priorBytes = await ctx.stub.getPrivateData(PRIVATE_COLLECTION, idempotencyKey);
    if (priorBytes && priorBytes.length > 0) {
      const prior = JSON.parse(priorBytes.toString());
      if (prior.inputHash !== inputHash) fail('IDEMPOTENCY_CONFLICT', 'eventId was already used for a different request');
      return JSON.stringify(prior.result);
    }
    const timestamp = txTimestamp(ctx);
    const result = { batchId, stored: true, createdAt: timestamp };
    await ctx.stub.putPrivateData(PRIVATE_COLLECTION, `commercialTerms:${batchId}`, Buffer.from(JSON.stringify({
      ...terms,
      batchId,
      createdByMsp: allowed.mspId,
      createdAt: timestamp,
    })));
    await ctx.stub.putPrivateData(PRIVATE_COLLECTION, idempotencyKey, Buffer.from(JSON.stringify({ inputHash, result })));
    const event = transactionEvent(ctx, allowed, eventId, batchId, 'PrivateCommercialTermsStored', timestamp, {
      privateTermsStored: true,
    });
    await writeEvents(ctx, [event]);
    return JSON.stringify(result);
  }

  async GetPrivateCommercialTerms(ctx, batchId) {
    const id = validateId(batchId, 'batchId');
    const actor = requireOrganization(ctx, ['OrgHarvestMSP', 'OrgProcessingMSP']);
    if (!['harvest_operator', 'processing_operator'].includes(actor.role)) {
      fail('FORBIDDEN', 'The verified Fabric identity is not authorized for this operation');
    }
    const bytes = await ctx.stub.getPrivateData(PRIVATE_COLLECTION, `commercialTerms:${id}`);
    if (!bytes || bytes.length === 0) fail('NOT_FOUND', 'Private commercial terms were not found');
    return bytes.toString();
  }
}

module.exports = { TraceabilityContract };
