const assert = require('node:assert/strict');
const test = require('node:test');

const { createRecord, updateRecord } = require('../api/crm/state');

function queuedSql(responses) {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ query: strings.join('?'), values });
    return responses.shift();
  };
  sql.calls = calls;
  return sql;
}

test('database assigns a fresh numeric ID when a requested create ID collides', async () => {
  const sql = queuedSql([[{
    record_id: '2038',
    payload: { id: 2038, name: 'Howard Test' },
    version: 1,
    updated_at: '2026-08-08T12:00:00Z'
  }]]);
  const result = await createRecord(sql, 'contact', {
    id: 2037,
    create: true,
    data: { id: 2037, name: 'Howard Test', _syncPendingCreate: true }
  });
  assert.equal(result.requestedId, '2037');
  assert.equal(result.id, '2038');
  assert.equal(result.data.id, 2038);
  assert.match(sql.calls[0].query, /pg_advisory_xact_lock/);
});

test('legacy zero-version creates also use server-assigned IDs', async () => {
  const sql = queuedSql([[{
    record_id: '2039',
    payload: { id: 2039, name: 'Liora Test' },
    version: 1,
    updated_at: '2026-08-08T12:01:00Z'
  }]]);
  const result = await updateRecord(sql, 'contact', {
    id: 2037,
    version: 0,
    data: { id: 2037, name: 'Liora Test' }
  });
  assert.equal(result.status, 'inserted');
  assert.equal(result.id, '2039');
  assert.equal(result.requestedId, '2037');
});

test('multiple sequential creates receive separate database IDs', async () => {
  const sql = queuedSql([
    [{ record_id: '2040', payload: { id: 2040, name: 'Test One' }, version: 1, updated_at: '2026-08-08T12:02:00Z' }],
    [{ record_id: '2041', payload: { id: 2041, name: 'Test Two' }, version: 1, updated_at: '2026-08-08T12:02:01Z' }]
  ]);
  const first = await createRecord(sql, 'contact', { id: -1000, data: { id: -1000, name: 'Test One' } });
  const second = await createRecord(sql, 'contact', { id: -1001, data: { id: -1001, name: 'Test Two' } });
  assert.deepEqual([first.id, second.id], ['2040', '2041']);
  assert.equal(sql.calls.length, 2);
});
