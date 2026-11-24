// Synthetic provider checks only; never reads Gmail or writes CRM records.
const {assessEmail,buildProposals}=require('../lib/business-email-review');
async function main() {
  const person={email:'jamie@example.invalid',name:'Jamie Lee',contact:{id:'fictional-907',name:'Jamie Lee',email:'jamie@example.invalid',company:'Old Company',position:'Director'}};
  const cases=[
    {name:'signature-only company and title change',text:'Tuesday works for me.',extra:'\n--\nJamie Lee\nVice President, New Company',expected:true},
    {name:'explicit job change',text:'I joined New Company as Vice President last week. Please use my new address jamie@newco.invalid.',extra:'',expected:true,fields:['company','position','email']},
    {name:'unchanged signature',text:'Tuesday works for me.',extra:'\n--\nJamie Lee\nDirector, Old Company',expected:false},
    {name:'unknown author never updates a profile',text:'I joined New Company as Vice President.',extra:'',unknown:true,expected:false}
  ];
  let failures=0;
  for(const item of cases) {
    const message={sourceMessageId:'synthetic-profile-'+cases.indexOf(item),sender:person,recipients:[{email:'andre@example.invalid'}],
      receivedAt:'2026-11-24T15:00:00Z',subject:'Quick update',bodyText:item.text,profileText:item.text+item.extra};
    const context={people:[item.unknown?{...person,contact:null}:person],engagements:[]};
    const assessment=await assessEmail(message,context,{ANTHROPIC_API_KEY:'server-managed'},async(_url,options)=>fetch('https://network-crm-data.vercel.app/api/coach',{
      ...options,headers:{'Content-Type':'application/json'}
    }));
    const rows=buildProposals(message,assessment,context);
    const profile=rows.find(row=>row.proposed.profileUpdate);
    const passed=Boolean(profile)===item.expected && (!item.fields || item.fields.every(field=>profile?.proposed.profileUpdate.values[field]));
    if(!passed)failures++;
    console.log(`${passed?'PASS':'FAIL'} ${item.name}: ${profile?Object.keys(profile.proposed.profileUpdate.values).join(', '):'no profile changes'}`);
  }
  process.exitCode=failures?1:0;
}
if(require.main===module)main().catch(()=>{console.error('Synthetic provider check unavailable; no CRM data changed.');process.exitCode=1;});
