const test=require('node:test'),assert=require('node:assert/strict');
const {prepareGroup,matchMembers,validateUpdates,saveGroup,ingestGroup}=require('../lib/group-sms');
const {isSkipSummary}=require('../lib/text-summaries');
const review=require('../api/crm/text-summaries');
const body={threadKey:'a'.repeat(64),threadTitle:'Dan and Pat',sourceKey:'group-example',startedAt:'2026-11-24T14:00:00Z',endedAt:'2026-11-24T14:02:00Z',
  participants:['Dan Example'],members:[{handle:'+15555550111',label:'Dan Example'},{handle:'+15555550222',label:'+15555550222'}],
  messages:[{at:'2026-11-24T14:00:00Z',isSelf:true,body:'Dan, can I introduce you to Lisa about your project?',senderLabel:'Andre'},
    {at:'2026-11-24T14:01:00Z',senderLabel:'Dan Example',senderHandle:'+15555550111',body:'Yes, please make that introduction.'}]};
const prepared=()=>prepareGroup(body);
const assessment=p=>({updates:[{participantKey:p.messages[1].senderKey,relevant:true,category:'business',summary:'Dan accepted Andre’s offer to introduce him to Lisa about the project. The introduction is not yet completed.',evidence:p.messages.map(m=>({messageId:m.id,quote:m.body}))}]});
const contacts=[{id:'1',name:'Dan Example',phone:'+1 (555) 555-0111'},{id:'2',name:'Pat Example',phone:'+15555550222'}];
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});

test('each real handle has its own roster identity; silent participants remain separate',()=>{
  const p=prepared();assert.equal(p.members.length,2);assert.equal(p.messages[1].senderKey,'phone:+15555550111');
  const members=matchMembers(p.members,contacts);
  assert.equal(members[0].contactId,'1');assert.equal(members[1].contactId,'2');
  const updates=validateUpdates(assessment(p),members,p.messages,p.messages.map(m=>m.id));
  assert.equal(updates.length,1);assert.equal(updates[0].member.contactId,'1');
});
test('a yes can cite the earlier ask, but a silent person cannot inherit that commitment',()=>{
  const p=prepared(),members=matchMembers(p.members,contacts);
  const result=assessment(p);
  result.updates.push({...result.updates[0],participantKey:'phone:+15555550222',summary:'Pat also agreed.'});
  assert.equal(validateUpdates(result,members,p.messages,[p.messages[1].id]).length,1);
  assert.equal(validateUpdates(assessment(p),members,p.messages,[]).length,0);
});
test('a tapback or laugh is not an inferred agreement by another participant',()=>{
  const p=prepared();p.messages[1].body='Loved “Dan, can I introduce you to Lisa?”';
  const result=assessment(p);result.updates[0].summary='Dan agreed to the intro.';
  assert.equal(validateUpdates(result,p.members,p.messages,p.messages.map(m=>m.id)).length,0);
});
test('unsubstantiated quotes retry rather than silently discard a claimed meaningful update',()=>{
  const p=prepared(),result=assessment(p);
  result.updates[0].evidence[1].quote='I committed to a signed contract';
  assert.throws(()=>validateUpdates(result,matchMembers(p.members,contacts),p.messages,p.messages.map(m=>m.id)),/Ungrounded/);
});
test('routine-chat exclusion text is not a note, while an explicit incoming work offer is protected',()=>{
  assert.equal(isSkipSummary('This exchange is routine personal small talk and reaction sharing around an AI observation—no business opportunity.'),true);
  const p=prepared();assert.deepEqual(validateUpdates({updates:[]},p.members,p.messages,p.messages.map(m=>m.id)),[]);
  const m={...p.messages[1],body:'Would you be interested in some contract work?',id:'paid-offer'};
  const updates=validateUpdates({updates:[]},p.members,[m],[m.id]);
  assert.equal(updates.length,1);assert.equal(updates[0].member.key,m.senderKey);assert.match(updates[0].summary,/work opportunity/);
});
test('ambiguous numbers stay unmatched; confirmed mappings take priority and aliases work',()=>{
  const members=prepared().members;
  const duplicate=[...contacts,{id:'3',name:'Another Person',phone:contacts[0].phone}];
  assert.equal(matchMembers(members,duplicate)[0].contactId,null);
  assert.equal(matchMembers(members,duplicate,[{participant_key:members[0].key,contact_id:'1'}])[0].contactId,'1');
  const alias=matchMembers([{key:'email:old@example.invalid',handle:'old@example.invalid',label:'old@example.invalid'}],[{id:'4',name:'Person',email:'new@example.invalid',emailAliases:['old@example.invalid']}]);
  assert.equal(alias[0].contactId,'4');
});
test('overlapping scans use old messages only as context and generate new per-speaker proposals once',async()=>{
  const p=prepared(),seen=[p.messages[0].id];let saved,called=0;
  const queries=[[],[{message_ids:seen}],[]];
  const sql=async()=>queries.shift() || [];
  const result=await ingestGroup(sql,body,{isGroup:true,threadKey:body.threadKey,title:body.threadTitle},contacts,{
    loadParticipantMatches:async()=>[],summarizeGroup:async args=>{called++;assert.deepEqual(args.newIds,[p.messages[1].id]);return assessment(p);},
    saveGroup:async(_sql,value)=>{saved=value;return [{claimed:1,inserted:1}];}
  });
  assert.equal(result.status,'pending');assert.equal(called,1);assert.equal(saved.drafts.length,1);
  assert.equal(saved.drafts[0].contact_id,'1');assert.equal(saved.drafts[0].context.members[1].messageCount,0);
  assert.equal(saved.drafts[0].context.evidenceMessages.length,2);
  const duplicate=await ingestGroup(async()=>[{source_key:'existing'}],body,{},[],{summarizeGroup:()=>{throw Error('not called');}});
  assert.equal(duplicate.status,'duplicate');
  const old=[[],[],[{conversation_started_at:body.startedAt,conversation_ended_at:body.endedAt}]];
  const reviewed=await ingestGroup(async()=>old.shift() || [],body,{threadKey:body.threadKey},contacts,{summarizeGroup:()=>{throw Error('reviewed messages must not be reanalyzed');}});
  assert.equal(reviewed.status,'duplicate');
});
test('participant match review validates roster membership and does not write CRM records',async()=>{
  const queries=[];const handler=review.createHandler({auth:()=>true,ensureSchema:async()=>{},getSql:()=>async(strings,...values)=>{
    const query=strings.join('?');queries.push(query);
    if(query.startsWith('SELECT conversation_context'))return [{conversation_context:{members:prepared().members}}];
    if(query.startsWith('SELECT record_id'))return [{record_id:'1'}];return [];
  }});
  const res=response();await handler({method:'PATCH',body:{resource:'participant',id:12,participantKey:'phone:+15555550111',contactId:'1'}},res);
  assert.equal(res.code,200);assert.ok(queries.some(q=>q.includes('INSERT INTO crm_sms_participant_matches')));
  assert.ok(queries.every(q=>!q.includes('UPDATE crm_records')));
  const wrong=response();await handler({method:'PATCH',body:{resource:'participant',id:12,participantKey:'phone:+15555559999',contactId:'1'}},wrong);
  assert.equal(wrong.code,400);
});

test('group receipts and participant proposals persist atomically; legacy pending noise is superseded, reviewed records are preserved', {skip:!process.env.CRM_SQL_INTEGRATION},async()=>{
  const {neon}=require('@neondatabase/serverless');const db=neon(process.env.DATABASE_URL),p=prepared();
  const context={isGroup:true,threadKey:body.threadKey,analysisVersion:2,participantKey:p.members[0].key,members:p.members};
  const args={sourceKey:'root',threadKey:body.threadKey,messages:p.messages,startedAt:p.messages[0].at,endedAt:p.messages[1].at,
    drafts:[{contact_id:'1',source_key:'child-dan',summary:'Dan agreed to an intro.',context,started_at:p.messages[0].at,ended_at:p.messages[1].at}]};
  let op;await saveGroup(async(strings,...values)=>{op={text:strings.reduce((out,part,i)=>out+(i?'$'+i:'')+part,''),values};return [];},args);
  const results=await db.transaction([
    db.query("CREATE TEMP TABLE crm_text_group_receipts (source_key text PRIMARY KEY,thread_key text,message_ids jsonb) ON COMMIT DROP"),
    db.query("CREATE TEMP TABLE crm_text_summaries (id BIGSERIAL PRIMARY KEY,contact_id text,source_key text UNIQUE,summary text,conversation_started_at timestamptz,conversation_ended_at timestamptz,message_count int,conversation_context jsonb,status text DEFAULT 'pending',reviewed_at timestamptz) ON COMMIT DROP"),
    db.query("INSERT INTO crm_text_summaries (source_key,summary,conversation_started_at,conversation_ended_at,conversation_context,status) VALUES ('old-pending','routine', $1::timestamptz,$2::timestamptz,$3::jsonb,'pending'),('old-approved','approved', $1::timestamptz,$2::timestamptz,$3::jsonb,'approved')",[args.startedAt,args.endedAt,JSON.stringify({isGroup:true,threadKey:body.threadKey})]),
    db.query(op.text,op.values),db.query(op.text,op.values),
    db.query('SELECT source_key,status FROM crm_text_summaries ORDER BY id')
  ]);
  assert.equal(results[3][0].inserted,1);assert.equal(results[4][0].claimed,0);
  assert.deepEqual(results[5],[{source_key:'old-pending',status:'dismissed'},{source_key:'old-approved',status:'approved'},{source_key:'child-dan',status:'pending'}]);
});

test('participant approval writes only the chosen contact and remembers its number atomically, once', {skip:!process.env.CRM_SQL_INTEGRATION},async()=>{
  const {neon}=require('@neondatabase/serverless');const db=neon(process.env.DATABASE_URL),p=prepared();let op;
  const context={isGroup:true,analysisVersion:2,title:'Dan and Pat',participantKey:p.members[0].key,members:p.members};
  const handler=review.createHandler({auth:()=>true,ensureSchema:async()=>{},getSql:()=>async(strings,...values)=>{
    const text=strings.reduce((out,part,i)=>out+(i?'$'+i:'')+part,'');
    if(text.includes('SELECT contact_id, conversation_ended_at'))return [{contact_id:'1',conversation_ended_at:body.endedAt,source_key:'child',conversation_context:context}];
    op={text,values};return [];
  }});
  await handler({method:'PATCH',body:{id:12,action:'approve',summary:'Dan accepted the introduction.',contactId:'1',rememberParticipant:true}},response());
  const original={id:1,name:'Dan Example',notes:'Original',tier:1,clientFitTier:2,status:'network_closely'};
  const results=await db.transaction([
    db.query('CREATE TEMP TABLE crm_records (LIKE public.crm_records INCLUDING ALL) ON COMMIT DROP'),
    db.query("CREATE TEMP TABLE crm_text_summaries (id bigint PRIMARY KEY,contact_id text,summary text,status text DEFAULT 'pending',reviewed_at timestamptz) ON COMMIT DROP"),
    db.query("CREATE TEMP TABLE crm_sms_participant_matches (participant_key text PRIMARY KEY,contact_id text,updated_at timestamptz DEFAULT NOW()) ON COMMIT DROP"),
    db.query("INSERT INTO crm_records (record_type,record_id,payload) VALUES ('contact','1',$1::jsonb),('contact','2',$2::jsonb)",[JSON.stringify(original),JSON.stringify({id:2,name:'Pat Example',notes:'Untouched'})]),
    db.query('INSERT INTO crm_text_summaries (id,contact_id) VALUES (12,NULL)'),
    db.query(op.text,op.values),db.query(op.text,op.values),
    db.query('SELECT record_id,payload,version FROM crm_records ORDER BY record_id'),
    db.query('SELECT participant_key,contact_id FROM crm_sms_participant_matches')
  ]);
  assert.equal(results[5].length,1);assert.equal(results[6].length,0);
  assert.equal(Number(results[7][0].version),2);assert.equal(results[7][0].payload.tier,1);assert.equal(results[7][0].payload.clientFitTier,2);
  assert.equal(results[7][0].payload.status,'network_closely');assert.match(results[7][0].payload.notes,/Original/);
  assert.equal(results[7][1].payload.notes,'Untouched');assert.equal(Number(results[7][1].version),1);
  assert.deepEqual(results[8],[{participant_key:'phone:+15555550111',contact_id:'1'}]);
});
