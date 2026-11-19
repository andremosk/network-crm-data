const test = require('node:test');
const assert = require('node:assert/strict');
const { runGmailReviewSync } = require('../lib/gmail-review-sync');
const { deferReview, loadRetries } = require('../lib/gmail-review-retries');

function setup() {
  const receipts=new Set(), failures=new Map(), actions=[], checkpoints=[];
  let list=[{id:'bad'},{id:'good'}], fail=true;
  const now=new Date('2026-11-18T20:00:00Z');
  const deps={
    getAccessToken:async()=> 'token',loadSyncState:async()=>({review_version:2,last_successful_at:'2026-11-17T20:00:00Z'}),
    listMessages:async()=>({messages:list}),loadEngagementContext:async()=>[],
    alreadyReviewed:async(_sql,id)=>receipts.has(id),loadRetries:async()=>[...failures.values()],
    getMessage:async(_token,id)=>({id,internalDate:String(now.getTime()),payload:{
      headers:[{name:'From',value:'Example Person <person@example.invalid>'},{name:'To',value:'andre@example.invalid'}],
      mimeType:'text/plain',body:{data:Buffer.from('Interested in a discovery project.').toString('base64url')}
    }}),
    findContactByEmail:async()=>({id:'12',name:'Example Person',email:'person@example.invalid'}),
    assessEmail:async message=>{
      if(message.sourceMessageId==='bad'&&fail)return {relevant:true,actions:[]};
      return {relevant:true,category:'business',actions:[{kind:'contact',personEmail:'person@example.invalid',note:'A discovery opportunity.',evidence:'Interested in a discovery project.'}]};
    },
    saveBusinessReview:async(_sql,id,rows)=>{receipts.add(id);actions.push(...rows);return {claimed:1,inserted:rows.length};},
    deferReview:async(_sql,_mailbox,id)=>failures.set(id,{id,next_attempt_at:'2026-11-18T20:15:00Z'}),
    clearRetry:async(_sql,_mailbox,id)=>failures.delete(id),retryCount:async()=>failures.size,
    saveSyncState:async(_sql,_mailbox,checkpoint)=>checkpoints.push(checkpoint)
  };
  return {deps,now,failures,actions,checkpoints,setList(value){list=value;},recover(){fail=false;}};
}

test('bad assessment does not block following messages, is not discarded, and later retries exactly once', async()=>{
  const s=setup();
  const options={sql:{},env:{NETWORK_CRM_GMAIL_MAILBOX:'andre@example.invalid'},dependencies:s.deps,now:s.now};
  const first=await runGmailReviewSync(options);
  assert.equal(first.proposed,1);assert.equal(first.deferred,1);assert.equal(first.retry_pending,1);
  assert.equal(s.checkpoints.at(-1),s.now.toISOString());
  s.setList([]);s.recover();
  const early=await runGmailReviewSync(options);
  assert.equal(early.proposed,0);assert.equal(early.retry_pending,1);
  const retry=await runGmailReviewSync({...options,now:new Date('2026-11-18T21:00:00Z')});
  assert.equal(retry.proposed,1);assert.equal(s.failures.size,0);
  assert.equal((await runGmailReviewSync(options)).proposed,0);
  assert.equal(s.actions.length,2);
});

test('failure to persist a retry does not advance the successful checkpoint', async()=>{
  const s=setup();
  s.deps.deferReview=async()=>{throw Error('database unavailable');};
  await assert.rejects(runGmailReviewSync({sql:{},env:{NETWORK_CRM_GMAIL_MAILBOX:'andre@example.invalid'},dependencies:s.deps,now:s.now}),/database unavailable/);
  assert.equal(s.checkpoints.length,1);
  assert.equal(s.checkpoints[0],'2026-11-17T20:00:00Z');
});

test('retry queue is mailbox-scoped, content-free and uses bounded backoff', async()=>{
  const calls=[];
  const sql=async(strings,...values)=>{calls.push({text:strings.join('?'),values});return [];};
  await deferReview(sql,'andre@example.invalid','message-123');
  await loadRetries(sql,'andre@example.invalid',new Date());
  assert.match(calls[0].text,/INTERVAL '24 hours'/);
  assert.match(calls[0].text,/ON CONFLICT \(mailbox_email, message_id\)/);
  assert.match(calls[1].text,/ORDER BY next_attempt_at LIMIT 250/);
  assert.deepEqual(calls[0].values,['andre@example.invalid','message-123']);
});
