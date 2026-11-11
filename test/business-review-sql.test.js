const test = require('node:test');
const assert = require('node:assert/strict');
const { neon } = require('@neondatabase/serverless');
const { saveBusinessReview } = require('../lib/gmail-review-sync');
const { applyUpdate } = require('../api/crm/communication-proposals');
const { applyEngagement } = require('../lib/communication-engagements');
const { ensureSchema } = require('../lib/crm-db');

test('business review SQL: atomic bundles and once-only approvals in isolated temporary tables', { skip: !process.env.CRM_SQL_INTEGRATION }, async () => {
  const db = neon(process.env.DATABASE_URL);
  const capture = async fn => {
    let op;
    await fn(async (strings,...values) => { op = { text:strings.reduce((s,part,index)=>s+(index ? `$${index}` : '')+part,''), values }; return []; });
    return { _capture: true, ...op };
  };
  const proposals=[{source:'email',sourceMessageId:'test-message:contact',sourceHash:'test-contact',recipientEmail:'test@example.invalid',occurredAt:'2026-11-09T23:00:00Z',proposalType:'update_contact',matchedContactId:'907',evidence:'Test introduction',proposed:{note:'Referral test'},reviewContext:{messageId:'test-message'}},
    {source:'email',sourceMessageId:'test-message:engagement',sourceHash:'test-engagement',recipientEmail:'test@example.invalid',occurredAt:'2026-11-09T23:00:00Z',proposalType:'create_engagement',matchedContactId:null,evidence:'Test project',proposed:{title:'Test pursuit'},reviewContext:{messageId:'test-message'}}];
  const updateDraft={id:1,proposal_type:'update_contact',occurred_at:'2026-11-09T23:00:00Z',review_context:{messageId:'test-message'}};
  const clean={note:'Referred Andre to a prospect.',reminder:{date:'2026-12-09',text:'Thank them and share outcome.'},status:'follow_up',followUpDate:'2026-12-09'};
  const engagementDraft={...updateDraft,id:2,proposal_type:'create_engagement'};
  const engagement={title:'Fictional test pursuit',organization:'Fictional test organization',opportunity:'AI training',currentState:'An introduction',note:'Test source note',contactIds:['907'],nextMilestone:'Discovery call'};
  const queries=[
    db.query('CREATE TEMP TABLE crm_records (LIKE public.crm_records INCLUDING ALL) ON COMMIT DROP'),
    db.query('CREATE TEMP TABLE crm_deleted_records (LIKE public.crm_deleted_records INCLUDING ALL) ON COMMIT DROP'),
    db.query(`CREATE TEMP TABLE crm_communication_proposals (id BIGSERIAL PRIMARY KEY, source text, source_message_id text UNIQUE, source_hash text UNIQUE, recipient_email text, occurred_at timestamptz, proposal_type text, matched_contact_id text, evidence text, proposed jsonb, review_context jsonb, status text DEFAULT 'pending', reviewed_at timestamptz) ON COMMIT DROP`),
    db.query('CREATE TEMP TABLE crm_email_review_receipts (message_id text PRIMARY KEY, review_version int, disposition text, reviewed_at timestamptz DEFAULT NOW()) ON COMMIT DROP'),
    db.query(`INSERT INTO crm_records (record_type,record_id,payload) VALUES ('contact','907',$1::jsonb)`,[JSON.stringify({id:907,name:'Fictional contact',status:'follow_up',followUpDate:'2026-11-15',notes:'Original note'})]),
    await capture(sql=>saveBusinessReview(sql,'test-message',proposals)),
    await capture(sql=>saveBusinessReview(sql,'test-message',proposals)),
    await capture(sql=>applyUpdate(sql,updateDraft,clean)),
    await capture(sql=>applyUpdate(sql,updateDraft,clean)),
    await capture(sql=>applyEngagement(sql,engagementDraft,engagement)),
    await capture(sql=>applyEngagement(sql,engagementDraft,engagement)),
    db.query('SELECT record_type,payload FROM crm_records ORDER BY record_type'),
    db.query('SELECT status FROM crm_communication_proposals ORDER BY id')
  ];
  // All writes target session-local temporary tables, dropped on commit; public CRM data is untouched.
  const results=await db.transaction(queries.map(query => query._capture ? db.query(query.text, query.values) : query),{isolationLevel:'Serializable'});
  assert.equal(results[5][0].inserted,2);
  assert.equal(results[6][0].inserted,0);
  assert.equal(results[7].length,1); assert.equal(results[8].length,0);
  assert.equal(results[9].length,1); assert.equal(results[10].length,0);
  const contact=results[11].find(r=>r.record_type==='contact').payload;
  assert.equal(contact.followUpDate,'2026-11-15');
  assert.equal(contact.communicationReminders.length,1);
  assert.equal(contact.communicationReminders[0].date,'2026-12-09');
  assert.match(contact.notes,/Original note/);
  const pursuit=results[11].find(r=>r.record_type==='engagement').payload;
  assert.equal(pursuit.status,'pursuit'); assert.equal(pursuit.notes.length,1);
  assert.equal(pursuit.notes[0].sourceKey,'test-message');
  assert.deepEqual(results[12].map(r=>r.status),['applied','applied']);
});

test('business review migration upgrades legacy constraints without touching public tables', { skip: !process.env.CRM_SQL_INTEGRATION }, async () => {
  const db=neon(process.env.DATABASE_URL),ops=[];
  await ensureSchema(async(strings,...values)=>{
    const text=strings.reduce((s,part,index)=>s+(index?`$${index}`:'')+part,'');
    if(text.includes('ALTER TABLE crm_communication_proposals ADD COLUMN') || (text.includes('DO $$') && text.includes('create_engagement'))) ops.push({text,values});
    return [];
  });
  assert.equal(ops.length,2);
  const results=await db.transaction([
    db.query(`CREATE TEMP TABLE crm_communication_proposals (proposal_type text CHECK (proposal_type IN ('create_contact','update_contact','no_action'))) ON COMMIT DROP`),
    ...ops.map(op=>db.query(op.text,op.values)),
    db.query(`INSERT INTO crm_communication_proposals (proposal_type) VALUES ('create_engagement') RETURNING review_context`),
    db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='crm_communication_proposals'::regclass`)
  ]);
  assert.deepEqual(results[3][0].review_context,{});
  assert.match(results[4][0].definition,/update_engagement/);
});
