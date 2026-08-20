const assert = require('node:assert/strict');
const test = require('node:test');

const { applyResults, changedRecords, createTemporaryId, shouldApplyPull } = require('../cloud-sync-core');

function payload(record) {
  const data = { ...record };
  Object.keys(data).forEach((key) => { if (key.startsWith('_sync')) delete data[key]; });
  return data;
}

function fingerprint(record) {
  return JSON.stringify(payload(record));
}

test('multiple sequential creates receive distinct temporary numeric IDs', () => {
  const contacts = [{ id: 2037 }];
  const first = createTemporaryId(contacts, 1000);
  contacts.push({ id: first });
  const second = createTemporaryId(contacts, 1000);
  assert.equal(first, -1000);
  assert.equal(second, -1001);
  assert.equal(Number.isInteger(first), true);
  assert.equal(Number.isInteger(second), true);
});

test('new contacts are explicitly sent as creates', () => {
  const contacts = [{ id: -1000, name: 'Test One', _syncPendingCreate: true }];
  const changed = changedRecords(contacts, new Map(), new Map(), payload, fingerprint);
  assert.deepEqual(changed, [{ id: -1000, version: 0, create: true, data: { id: -1000, name: 'Test One' } }]);
});

test('an older cloud pull cannot replace a contact queued while it was in flight', () => {
  assert.equal(shouldApplyPull(4, 5, true, false), false);
  assert.equal(shouldApplyPull(4, 4, false, true), false);
  assert.equal(shouldApplyPull(4, 4, false, false), true);
});

test('server-assigned IDs remap sequential creates and preserve unsaved edits', () => {
  const contacts = [
    { id: -1000, name: 'Test One edited', _syncPendingCreate: true },
    { id: -1001, name: 'Test Two', _syncPendingCreate: true }
  ];
  const versions = new Map();
  const fingerprints = new Map();
  const sent = [
    { id: -1000, data: { id: -1000, name: 'Test One' } },
    { id: -1001, data: { id: -1001, name: 'Test Two' } }
  ];
  const results = [
    { requestedId: '-1000', id: '2038', status: 'inserted', version: 1, data: { id: 2038, name: 'Test One' } },
    { requestedId: '-1001', id: '2039', status: 'inserted', version: 1, data: { id: 2039, name: 'Test Two' } }
  ];
  const applied = applyResults(contacts, versions, fingerprints, results, sent, fingerprint);
  assert.deepEqual(contacts.map(({ id, name }) => ({ id, name })), [
    { id: 2038, name: 'Test One edited' },
    { id: 2039, name: 'Test Two' }
  ]);
  assert.deepEqual(applied.remaps, [
    { requestedId: '-1000', assignedId: '2038' },
    { requestedId: '-1001', assignedId: '2039' }
  ]);
  assert.equal(fingerprints.get('2038'), JSON.stringify({ id: 2038, name: 'Test One' }));
  assert.equal(changedRecords(contacts, versions, fingerprints, payload, fingerprint).length, 1);
});
