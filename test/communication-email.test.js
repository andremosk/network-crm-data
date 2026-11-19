const test = require('node:test');
const assert = require('node:assert/strict');
const {createHandler,readMessage,loadSource} = require('../api/crm/communication-email');
const {textBody} = require('../lib/gmail-review-sync');
const response = () => ({headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
const encoded = value => Buffer.from(value).toString('base64url');

test('full email requires a CRM session before any database or Gmail access', async () => {
  const res=response();
  await createHandler({auth:()=>false,getSql:()=>{throw Error('must not read');}})({method:'GET'},res);
  assert.equal(res.code,401);
  assert.equal(res.headers['Cache-Control'],'private, no-store');
});

test('full email accepts only GET and a valid proposal ID', async () => {
  const handler=createHandler({auth:()=>true,getSql:()=>{throw Error('must not read');}});
  for (const [request,status] of [[{method:'PATCH'},405],[{method:'GET',query:{proposalId:'1;DROP'}},400]]) {
    const res=response();await handler(request,res);assert.equal(res.code,status);
  }
});

test('source lookup is read-only and scoped to pending email proposals', async () => {
  let query;
  await loadSource(async (strings,...values)=>{query=strings.join('?');assert.deepEqual(values,[12]);return [];},12);
  assert.match(query,/source = 'email' AND status = 'pending'/);
  assert.doesNotMatch(query,/UPDATE|INSERT|DELETE/);
});

test('only the stored source message can be fetched, not a caller-selected Gmail ID', async () => {
  const handler=createHandler({auth:()=>true,getSql:()=>({}),loadSource:async()=>({review_context:{messageId:'stored-id'}}),
    getAccessToken:async()=> 'server-token',readMessage:async(token,id)=>{assert.equal(token,'server-token');assert.equal(id,'stored-id');return {body:'Complete email'};}});
  const res=response();await handler({method:'GET',query:{proposalId:'12',messageId:'unrelated-id'}},res);
  assert.equal(res.code,200);assert.equal(res.body.email.body,'Complete email');
  assert.doesNotMatch(JSON.stringify(res.body),/server-token/);
});

test('missing sources and provider failures fail safely without leaking provider details', async () => {
  const deps={auth:()=>true,getSql:()=>({}),getAccessToken:async()=> 'token'};
  const missing=response();await createHandler({...deps,loadSource:async()=>null})({method:'GET',query:{proposalId:12}},missing);
  assert.equal(missing.code,404);
  const failed=response();await createHandler({...deps,loadSource:async()=>({source_message_id:'gmail-id'}),readMessage:async()=>{throw Error('secret provider detail');}})({method:'GET',query:{proposalId:12}},failed);
  assert.equal(failed.code,503);assert.doesNotMatch(JSON.stringify(failed.body),/secret/);
});

test('previously queued missing-email suggestions resolve their original Gmail message', async () => {
  const res=response();
  await createHandler({auth:()=>true,getSql:()=>({}),loadSource:async()=>({source_message_id:'enrichment:original-id:person@example.invalid'}),
    getAccessToken:async()=> 'token',readMessage:async(_token,id)=>{assert.equal(id,'original-id');return {body:'Original message'};}
  })({method:'GET',query:{proposalId:12}},res);
  assert.equal(res.code,200);
});

test('complete email retains long text, signatures and quoted replies, not the snippet', async () => {
  const body='Full opening\n'+ 'Long content. '.repeat(1400)+'\nBest, Sender\nOn Monday wrote:\n> Earlier context';
  const email=await readMessage('token','gmail-id',async()=>({ok:true,json:async()=>({internalDate:'1795104360000',snippet:'Short snippet',payload:{mimeType:'text/plain',headers:[{name:'From',value:'Sender <sender@example.invalid>'}],body:{data:encoded(body)}}})}));
  assert.equal(email.body,body);assert.match(email.from,/Sender/);
});

test('HTML review retains quoted history but removes executable markup; screening still omits quotes', () => {
  const part={mimeType:'text/html',body:{data:encoded('<p>New message</p><blockquote>Older message</blockquote><script>bad()</script>')}};
  assert.match(textBody(part,{includeQuoted:true}),/Older message/);
  assert.doesNotMatch(textBody(part),/Older message/);
  assert.doesNotMatch(textBody(part,{includeQuoted:true}),/bad\(\)|<script>/);
});

test('large inline body is loaded from Gmail attachment storage, not truncated', async () => {
  const email=await readMessage('token','gmail-id',async url=>({ok:true,json:async()=>url.includes('/attachments/')
    ? {data:encoded('Entire large body')}
    : {internalDate:'1795104360000',payload:{mimeType:'text/plain',body:{attachmentId:'large-body'}}}}));
  assert.equal(email.body,'Entire large body');
});
