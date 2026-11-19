const test = require('node:test');
const assert = require('node:assert/strict');
const {neon} = require('@neondatabase/serverless');
const {saveExclusions,reviewedIds} = require('../lib/gmail-review-sync');
const {deferReview,clearRetry} = require('../lib/gmail-review-retries');

test('retry and bulk cache SQL preserve decisions in temporary tables', {skip:!process.env.CRM_SQL_INTEGRATION}, async()=>{
  const db=neon(process.env.DATABASE_URL);
  const capture=async fn=>{
    let op;
    await fn(async(strings,...values)=>{op={text:strings.reduce((text,part,index)=>text+(index?'$'+index:'')+part,''),values};return [];});
    return op;
  };
  const ops=[
    await capture(sql=>saveExclusions(sql,['keep','new'])),
    await capture(sql=>reviewedIds(sql,['keep','new','old'])),
    await capture(sql=>deferReview(sql,'mailbox','failed')),
    await capture(sql=>deferReview(sql,'mailbox','failed')),
    await capture(sql=>clearRetry(sql,'mailbox','failed'))
  ];
  const run=index=>db.query(ops[index].text,ops[index].values);
  const results=await db.transaction([
    db.query("CREATE TEMP TABLE crm_email_review_receipts (message_id text PRIMARY KEY,review_version int,disposition text,reviewed_at timestamptz DEFAULT NOW()) ON COMMIT DROP"),
    db.query("CREATE TEMP TABLE crm_communication_proposals (source text,source_message_id text) ON COMMIT DROP"),
    db.query("CREATE TEMP TABLE crm_gmail_review_retries (mailbox_email text,message_id text,attempts int,next_attempt_at timestamptz,PRIMARY KEY(mailbox_email,message_id)) ON COMMIT DROP"),
    db.query("INSERT INTO crm_email_review_receipts VALUES ('keep',2,'proposed',NOW())"),
    db.query("INSERT INTO crm_communication_proposals VALUES ('email','old')"),
    run(0),run(1),run(2),run(3),
    db.query("SELECT attempts FROM crm_gmail_review_retries"),
    run(4),
    db.query("SELECT message_id,disposition FROM crm_email_review_receipts ORDER BY message_id"),
    db.query("SELECT COUNT(*)::int AS count FROM crm_gmail_review_retries")
  ]);
  assert.deepEqual(results[6].map(row=>row.id).sort(),['keep','new','old']);
  assert.equal(results[9][0].attempts,2);
  assert.deepEqual(results[11],[{message_id:'keep',disposition:'proposed'},{message_id:'new',disposition:'excluded'}]);
  assert.equal(results[12][0].count,0);
});
