// Optional real-provider evaluation using fictional group exchanges only.
const {prepareGroup,matchMembers,summarizeGroup,validateUpdates}=require('../lib/group-sms');
async function main() {
  const base={members:[{handle:'+15555550111',label:'Dan Example'},{handle:'+15555550222',label:'Pat Example'},{handle:'+15555550333',label:'Silent Example'}]};
  const cases=[
    {name:'intro acceptance belongs to Dan, not silent participants',expected:1,messages:[
      {isSelf:true,senderLabel:'Andre',body:'Dan, would you like an introduction to Lisa about the company project?'},
      {senderHandle:'+15555550111',senderLabel:'Dan Example',body:'Yes, please make the introduction.'}]},
    {name:'AI joke and reaction are not a CRM update',expected:0,messages:[
      {senderHandle:'+15555550111',senderLabel:'Dan Example',body:'That AI-generated baseball meme is hilarious.'},
      {senderHandle:'+15555550222',senderLabel:'Pat Example',body:'LOL'}]},
    {name:'two business contributors have two separately attributed updates',expected:2,messages:[
      {senderHandle:'+15555550111',senderLabel:'Dan Example',body:'Andre, would you be interested in some contract work? We need a receivables dashboard.'},
      {senderHandle:'+15555550222',senderLabel:'Pat Example',body:'I can send you my factory workflow mapping as a reference for that dashboard.'}]}
  ];
  let failures=0;
  for(const item of cases) {
    const prepared=prepareGroup({...base,messages:item.messages.map((m,i)=>({...m,at:`2026-11-25T14:0${i}:00Z`}))});
    const args={...prepared,newIds:prepared.messages.map(m=>m.id)};
    const result=await summarizeGroup(args,{ANTHROPIC_API_KEY:'server-managed'},async(_url,options)=>fetch('https://network-crm-data.vercel.app/api/coach',{
      ...options,headers:{'Content-Type':'application/json'}
    }));
    const updates=validateUpdates(result,prepared.members,prepared.messages,args.newIds);
    const passed=updates.length===item.expected && !updates.some(u=>u.member.handle==='+15555550333');
    console.log(`${passed?'PASS':'FAIL'} ${item.name}: ${updates.length} updates`);
    if(!passed)failures++;
  }
  process.exitCode=failures?1:0;
}
if(require.main===module)main().catch(error=>{console.error('Synthetic group evaluation failed:',error.message);process.exitCode=1;});
