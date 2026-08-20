const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const EngagementCore = require('../engagement-core');
const { createRecord, getState } = require('../api/crm/state');

function queuedSql(responses) {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ query: strings.join('?'), values });
    return responses.shift();
  };
  sql.calls = calls;
  return sql;
}

test('legacy engagement values receive stable defaults', () => {
  const item = EngagementCore.withDefaults({
    id: '7',
    title: 'Belmont Metals',
    client: 'Belmont Metals',
    status: 'Active Client',
    linkedContactIds: ['12', 12, '18'],
    notes: 'Initial context',
    created_date: '2026-08-20'
  });
  assert.equal(item.id, 7);
  assert.equal(item.organization, 'Belmont Metals');
  assert.equal(item.status, 'active_client');
  assert.deepEqual(item.contactIds, [12, 18]);
  assert.deepEqual(item.notes, [{ id: 'note-1', date: '2026-08-20', html: 'Initial context' }]);
});

test('engagement list prioritizes active dated, active undated, then closed', () => {
  const sorted = EngagementCore.sort([
    { id: 1, title: 'Closed', status: 'closed', nextMilestoneDate: '2026-08-01' },
    { id: 2, title: 'Undated', status: 'pursuit' },
    { id: 3, title: 'Later', status: 'proposal', nextMilestoneDate: '2026-09-10' },
    { id: 4, title: 'Sooner', status: 'active_client', nextMilestoneDate: '2026-08-25' }
  ]);
  assert.deepEqual(sorted.map(item => item.id), [4, 3, 2, 1]);
});

test('engagement creates use their own server-assigned numeric ID lane', async () => {
  const sql = queuedSql([[
    {
      record_id: '3',
      payload: { id: 3, title: 'National XI Manager' },
      version: 1,
      updated_at: '2026-08-20T12:00:00Z'
    }
  ]]);
  const result = await createRecord(sql, 'engagement', {
    id: -123,
    create: true,
    data: { id: -123, title: 'National XI Manager', _syncPendingCreate: true }
  });
  assert.equal(result.id, '3');
  assert.equal(result.data.id, 3);
  assert.equal(sql.calls[0].values.includes('engagement'), true);
});

test('cloud state separates engagements from contacts and applications', async () => {
  const sql = queuedSql([[
    { record_type: 'contact', record_id: '1', payload: { id: 1, name: 'Person' }, version: 2, updated_at: '2026-08-20T10:00:00Z' },
    { record_type: 'application', record_id: '2', payload: { id: 2, company: 'Company' }, version: 1, updated_at: '2026-08-20T10:01:00Z' },
    { record_type: 'engagement', record_id: '3', payload: { id: 3, title: 'Pursuit' }, version: 1, updated_at: '2026-08-20T10:02:00Z' }
  ]]);
  const state = await getState(sql);
  assert.equal(state.contacts.length, 1);
  assert.equal(state.apps.length, 1);
  assert.equal(state.engagements.length, 1);
  assert.equal(state.engagements[0].title, 'Pursuit');
});

test('schema and browser sync both include the engagement record lane', () => {
  const schema = fs.readFileSync('lib/crm-db.js', 'utf8');
  const sync = fs.readFileSync('cloud-sync.js', 'utf8');
  assert.match(schema, /'contact', 'application', 'engagement'/);
  assert.match(sync, /engagements: changedRecords\(engagements/);
  assert.match(sync, /deletedEngagements: deletedRecords\(engagements/);
});
