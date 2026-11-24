const test=require('node:test');
const assert=require('node:assert/strict');
const {buildProfileProposal,profilePatch,sanitizeProfileUpdate,applyProfileUpdate,findContactByEmail}=require('../lib/profile-updates');
const {buildProposals}=require('../lib/business-email-review');
const {normalizedInboundMessage}=require('../lib/gmail-review-sync');
const {createHandler}=require('../api/crm/communication-proposals');
const contact={id:'907',name:'Jamie Lee',company:'Old Company',position:'Director',email:'old@example.invalid',notes:'Keep notes',tier:1,
  clientFitTier:2,connectorFitTier:3,status:'follow_up',followUpDate:'2026-12-10'};
const person={email:'new@example.invalid',name:'Jamie Lee',contact,matchMethod:'unique_name'};
const message={sourceMessageId:'profile-123',sender:person,receivedAt:'2026-11-24T14:00:00Z',subject:'An update',
  bodyText:'I joined New Company as Vice President.',profileText:'I joined New Company as Vice President.\n--\nJamie Lee\nVice President, New Company'};
const action={kind:'profile',personEmail:person.email,company:'New Company',position:'Vice President',
  profileEvidence:{company:'I joined New Company as Vice President.',position:'Vice President, New Company'}};
const draftFrom=proposal=>({id:12,matched_contact_id:'907',proposal_type:'update_contact',occurred_at:proposal.occurredAt,
  proposed:proposal.proposed,review_context:proposal.reviewContext});
const proposal=()=>buildProfileProposal(message,action,person);

test('profile proposals are grounded in the matched author, default to preserving existing role and address, and have stable IDs',()=>{
  const p=proposal();assert.equal(p.proposalType,'update_contact');
  assert.deepEqual(p.proposed.profileUpdate.values,{company:'New Company',position:'Vice President',email:'new@example.invalid'});
  assert.equal(p.proposed.profileUpdate.roleMode,'additional');assert.equal(p.proposed.profileUpdate.emailMode,'additional');
  assert.equal(proposal().sourceHash,p.sourceHash);
  assert.equal(buildProfileProposal(message,action,{...person,email:'copied@example.invalid'}),null);
  assert.equal(buildProfileProposal(message,action,{...person,contact:null}),null);
});
test('invented, quoted and unchanged values never become profile changes',()=>{
  const p=buildProfileProposal({...message,sender:{...person,email:contact.email}},
    {...action,company:'Invented',position:'CEO',profileEvidence:{company:'Invented company',position:'CEO'}}, {...person,email:contact.email});
  assert.equal(p,null);
  const raw={id:'gmail-id',internalDate:'1795528800000',payload:{mimeType:'text/plain',headers:[{name:'From',value:'Jamie Lee <old@example.invalid>'},{name:'To',value:'andre@example.invalid'}],
    body:{data:Buffer.from('Hi Andre,\n--\nDirector, Old Company\nOn Monday, Someone wrote:\nCEO, Unrelated Company').toString('base64url')}}};
  const normalized=normalizedInboundMessage(raw,'andre@example.invalid');
  assert.match(normalized.profileText,/Director, Old Company/);assert.doesNotMatch(normalized.profileText,/Unrelated Company/);
  assert.doesNotMatch(normalized.bodyText,/Director, Old Company/);
});
test('known new sender address can be proposed even when email has no business note, without creating a person',()=>{
  const rows=buildProposals(message,{relevant:false,actions:[]},{people:[person],engagements:[]});
  assert.equal(rows.length,1);assert.equal(rows[0].proposed.profileUpdate.values.email,person.email);
  assert.equal(rows[0].proposed.profileUpdate.values.company,undefined);
  assert.equal(buildProposals(message,{relevant:false,actions:[]},{people:[{...person,contact:null}],engagements:[]}).length,0);
  assert.equal(buildProposals(message,{relevant:true,actions:[action]},{people:[{...person,contact:null}],engagements:[]}).length,0);
});
test('profile and interaction actions stay independently reviewable for the same email',()=>{
  const rows=buildProposals(message,{relevant:true,category:'business',actions:[action,{kind:'contact',personEmail:person.email,note:'A job change.',evidence:message.bodyText}]},{people:[person],engagements:[]});
  assert.equal(rows.length,2);assert.notEqual(rows[0].sourceHash,rows[1].sourceHash);
  assert.equal(rows[1].proposed.email,'');
});
test('an already approved secondary role or email alias is not proposed again from every signature',()=>{
  const known={...person,contact:{...contact,emailAliases:['new@example.invalid'],additionalRoles:[{company:'New Company',position:'Vice President'}]}};
  assert.equal(buildProfileProposal(message,action,known),null);
});
test('approval stores additional roles/addresses and field sources without touching primary fields or notes/ratings/status',()=>{
  const p=proposal(),patch=profilePatch(contact,p.proposed.profileUpdate,draftFrom(p));
  assert.equal(patch.company,undefined);assert.equal(patch.position,undefined);assert.equal(patch.email,undefined);
  assert.equal(patch.additionalRoles[0].company,'New Company');assert.deepEqual(patch.emailAliases,['new@example.invalid']);
  assert.equal(patch.additionalRoles[0].source.observedAt,new Date(message.receivedAt).toISOString());
  for(const field of ['notes','tier','clientFitTier','connectorFitTier','status','followUpDate','lastContact'])assert.equal(patch[field],undefined);
});
test('primary approval preserves old email as alias and prior roles in history; unselected fields do not change',()=>{
  const p=proposal();p.proposed.profileUpdate.roleMode='primary';p.proposed.profileUpdate.emailMode='primary';
  const patch=profilePatch(contact,p.proposed.profileUpdate,draftFrom(p));
  assert.equal(patch.company,'New Company');assert.equal(patch.email,'new@example.invalid');assert.deepEqual(patch.emailAliases,['old@example.invalid']);
  assert.equal(patch.profileHistory[0].before.company,'Old Company');
  assert.equal(patch.profileFieldSources.company.value,'New Company');
  const selected=profilePatch(contact,{...p.proposed.profileUpdate,selected:['email']},draftFrom(p));
  assert.equal(selected.company,undefined);assert.equal(selected.profileHistory[0].before.company,undefined);
});
test('changed manual fields, newer verified sources and empty selections cannot be overwritten',()=>{
  const p=proposal(),draft=draftFrom(p),update={...p.proposed.profileUpdate,roleMode:'primary'};
  assert.throws(()=>profilePatch({...contact,company:'Manual edit'},update,draft),/changed/);
  assert.throws(()=>profilePatch({...contact,profileFieldSources:{company:{observedAt:'2026-11-25T00:00:00Z'}}},update,draft),/newer/);
  assert.throws(()=>profilePatch(contact,{...update,selected:[]},draft),/Select/);
  const clean=sanitizeProfileUpdate({...update,selected:['tier','company'],values:{...update.values,tier:4}});
  assert.deepEqual(clean.selected,['company']);assert.equal(clean.values.tier,undefined);
});
test('email alias matching is scoped to active contacts and returns no arbitrary match for duplicate addresses',async()=>{
  let query;
  const sql=async(strings)=>{query=strings.join('?');return [{record_id:'907',payload:contact}];};
  assert.equal((await findContactByEmail(sql,'NEW@example.invalid')).id,'907');
  assert.match(query,/emailAliases/);assert.match(query,/LIMIT 2/);assert.match(query,/archived/);
  assert.equal(await findContactByEmail(async()=>[{record_id:'1'},{record_id:'2'}],'same@example.invalid'),null);
});
test('Save Edit/Ignore never change the profile; approval uses immutable comparison values from the saved proposal',async()=>{
  const p=proposal(),draft=draftFrom(p);let applied=0;
  const handler=createHandler({auth:()=>true,getSql:()=>({}),ensureSchema:async()=>{},loadPending:async()=>draft,
    editProposal:async(_sql,_id,_type,value)=>({proposed:value}),ignoreProposal:async()=>true,
    applyProfileUpdate:async(_sql,_draft,value)=>{applied++;assert.equal(value.profileUpdate.expected.company,'Old Company');return '907';}});
  const response=()=>({status(code){this.code=code;return this;},json(body){this.body=body;},setHeader(){}});
  const malicious={profileUpdate:{...p.proposed.profileUpdate,expected:{company:'Forged'}}};
  for(const action of ['edit','ignore'])await handler({method:'PATCH',body:{id:12,action,proposed:malicious}},response());
  assert.equal(applied,0);
  const res=response();await handler({method:'PATCH',body:{id:12,action:'apply',proposed:malicious}},res);
  assert.equal(applied,1);assert.equal(res.code,200);
});

test('profile approval SQL is atomic, deduped, version-guarded, collision-safe, and old aliases remain matchable', {skip:!process.env.CRM_SQL_INTEGRATION},async()=>{
  const {neon}=require('@neondatabase/serverless'), db=neon(process.env.DATABASE_URL);
  const p=proposal();p.proposed.profileUpdate.roleMode='primary';p.proposed.profileUpdate.emailMode='primary';
  const draft=draftFrom(p);
  async function capture(draft,proposed,fixture,version) {
    let op;
    await applyProfileUpdate(async(strings,...values)=>{
      const text=strings.reduce((out,part,i)=>out+(i?'$'+i:'')+part,'');
      if(text.startsWith('SELECT payload,version'))return [{payload:fixture,version}];
      op={text,values};return [];
    },draft,proposed);
    return {_capture:true,...op};
  }
  const valid=await capture(draft,p.proposed,contact,1);
  const stale=await capture({...draft,id:13},p.proposed,contact,1);
  const current={...contact,company:'New Company',position:'Vice President',email:'new@example.invalid'};
  const blocked={profileUpdate:sanitizeProfileUpdate({values:{email:'occupied@example.invalid'},expected:current,selected:['email'],emailMode:'additional'})};
  const collision=await capture({...draft,id:14,proposed:blocked},blocked,current,2);
  let aliasQuery;await findContactByEmail(async(strings,...values)=>{aliasQuery={text:strings.reduce((out,part,i)=>out+(i?'$'+i:'')+part,''),values};return [];},contact.email);
  const queries=[
    db.query('CREATE TEMP TABLE crm_records (LIKE public.crm_records INCLUDING ALL) ON COMMIT DROP'),
    db.query("CREATE TEMP TABLE crm_communication_proposals (id bigint PRIMARY KEY,status text DEFAULT 'pending',proposed jsonb,reviewed_at timestamptz) ON COMMIT DROP"),
    db.query("INSERT INTO crm_records (record_type,record_id,payload) VALUES ('contact','907',$1::jsonb),('contact','908',$2::jsonb)",[JSON.stringify(contact),JSON.stringify({id:908,email:'occupied@example.invalid'})]),
    db.query('INSERT INTO crm_communication_proposals (id) VALUES (12),(13),(14)'),
    valid,valid,stale,collision,
    db.query(aliasQuery.text,aliasQuery.values),
    db.query("SELECT payload,version FROM crm_records WHERE record_id='907'"),
    db.query('SELECT status FROM crm_communication_proposals ORDER BY id')
  ];
  const results=await db.transaction(queries.map(query=>query._capture?db.query(query.text,query.values):query));
  assert.equal(results[4].length,1);for(const i of [5,6,7])assert.equal(results[i].length,0);
  assert.equal(results[8][0].record_id,'907');
  const saved=results[9][0];assert.equal(Number(saved.version),2);assert.equal(saved.payload.notes,contact.notes);
  assert.equal(saved.payload.tier,contact.tier);assert.equal(saved.payload.followUpDate,contact.followUpDate);
  assert.equal(saved.payload.company,'New Company');assert.equal(saved.payload.profileHistory.length,1);
  assert.deepEqual(saved.payload.emailAliases,['old@example.invalid']);
  assert.deepEqual(results[10].map(row=>row.status),['applied','pending','pending']);
});

test('pending and ignored profile fingerprints prevent repeat-signature queue spam across messages', {skip:!process.env.CRM_SQL_INTEGRATION},async()=>{
  const {neon}=require('@neondatabase/serverless');const db=neon(process.env.DATABASE_URL);
  const {ensureSchema}=require('../lib/crm-db');const {saveBusinessReview}=require('../lib/gmail-review-sync');
  let index;
  await ensureSchema(async(strings,...values)=>{const text=strings.join('');if(text.includes('crm_profile_pending_values_idx'))index={text,values};return [];});
  async function capture(id,who=person) {
    const p=buildProfileProposal({...message,sourceMessageId:id},action,who);let op;
    await saveBusinessReview(async(strings,...values)=>{op={text:strings.reduce((out,part,i)=>out+(i?'$'+i:'')+part,''),values};return [];},id,[p]);
    return {_capture:true,...op};
  }
  const queries=[
    db.query("CREATE TEMP TABLE crm_communication_proposals (id BIGSERIAL PRIMARY KEY,source text,source_message_id text UNIQUE,source_hash text UNIQUE,recipient_email text,occurred_at timestamptz,proposal_type text,matched_contact_id text,evidence text,proposed jsonb,review_context jsonb,status text DEFAULT 'pending') ON COMMIT DROP"),
    db.query("CREATE TEMP TABLE crm_email_review_receipts (message_id text PRIMARY KEY,review_version int,disposition text,reviewed_at timestamptz DEFAULT NOW()) ON COMMIT DROP"),
    db.query(index.text,index.values),
    await capture('one'),await capture('two'),
    db.query("UPDATE crm_communication_proposals SET status='ignored'"),
    await capture('three'),
    await capture('four',{...person,contact:{...contact,company:'Manual Company'}}),
    db.query('SELECT status FROM crm_communication_proposals ORDER BY id')
  ];
  const results=await db.transaction(queries.map(query=>query._capture?db.query(query.text,query.values):query));
  assert.equal(results[3][0].inserted,1);assert.equal(results[4][0].inserted,0);assert.equal(results[6][0].inserted,0);
  assert.equal(results[7][0].inserted,1);assert.deepEqual(results[8].map(row=>row.status),['ignored','pending']);
});
