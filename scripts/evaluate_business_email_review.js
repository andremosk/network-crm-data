// Opt-in, synthetic provider checks. No CRM reads or writes and no real message content.
const { assessEmail, buildProposals } = require('../lib/business-email-review');

const cases = [
  { name:'business introduction', subject:'Introducing Jamie and Andre',
    text:'Hi Jamie and Andre, I think there is an opportunity for you to work together. Jamie is the Portfolio Success Manager at Orbit Five in Denver and wants AI training for the team. I will leave you to connect and assess fit. Cheers, Avery',
    business:true, referral:true },
  { name:'business offer inside baseball thread', subject:'Little League parents',
    text:'Practice is at six. Separate thing, Avery here: our manufacturing company Orbit Five needs help automating purchasing approvals. Can I hire Andre for a paid discovery session next week? I can introduce our operations manager Jamie.', business:true },
  { name:'routine kids logistics', subject:'Little League parents',
    text:'Can you bring the baseball bag tomorrow? Jamie will drive the kids. Avery can cover third base. The game starts at six. Thanks!', business:false },
  { name:'fantasy sports', subject:'Trade proposal',
    text:'Avery here. Want to trade your pitcher for my shortstop? Our fantasy baseball league deadline is tonight. Jamie thinks the offer is fair.', business:false },
  { name:'specific personal opener', subject:'Proposed new time',
    text:'Hi Andre, Dave and I are taking a much needed vacation. Can we catch up on the 23rd instead? Cheers, Avery', relationship:true },
  { name:'client work update', subject:'Orbit Five project',
    text:'Hi Andre, the purchasing prototype is approved for a staff pilot. Jamie needs the permissions model documented before we can launch. I will send the sample order data Friday. Please send a draft training agenda. Thanks, Avery', business:true, existing:true }
];

async function main() {
  let failures = 0;
  for (const item of cases) {
    const message = { sourceMessageId:`synthetic-${item.name}`,receivedAt:'2026-11-09T23:57:56Z',
      sender:{name:'Avery Chen',email:'avery@example.invalid'},recipients:[{email:'andre@example.invalid'},{name:'Jamie Lee',email:'jamie@orbit.invalid'}],
      subject:item.subject,bodyText:item.text };
    const context = { people:[{...message.sender,contact:{id:'907',name:'Avery Chen',email:message.sender.email}}, {...message.recipients[1],contact:null}],
      engagements:item.existing ? [{id:'12',title:'Orbit Five purchasing pilot',organization:'Orbit Five',status:'active_client',contactIds:['907']}] : [] };
    const result = await assessEmail(message,context,{ANTHROPIC_API_KEY:'server-managed'},async(_url,options)=> fetch('https://network-crm-data.vercel.app/api/coach',{
      ...options,headers:{'Content-Type':'application/json'}
    }));
    const proposals = buildProposals(message,result,context);
    const passed = item.business ? result.category === 'business' && proposals.length > 0
      && (!item.referral || (proposals.some(row=>row.proposed.reminder) && proposals.some(row=>row.proposalType === 'create_engagement')))
      && (!item.existing || (proposals.some(row=>row.proposalType === 'update_engagement') && !proposals.some(row=>row.proposalType === 'create_engagement')))
      : item.relationship ? proposals.length === 1 && proposals[0].proposalType === 'update_contact'
      : proposals.length === 0;
    console.log(`${passed ? 'PASS' : 'FAIL'} ${item.name}: ${result.category}; ${proposals.map(row=>row.proposalType).join(', ') || 'no action'}`);
    if (!passed && process.env.REVIEW_EVAL_DEBUG) console.log(JSON.stringify(result));
    if (!passed) failures++;
  }
  process.exitCode = failures ? 1 : 0;
}
if (require.main === module) main().catch(() => { console.error('Provider evaluation unavailable; no CRM data changed.'); process.exitCode = 1; });
module.exports = { cases };
