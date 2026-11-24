const {cleanText,normalizeEmail,sourceHash} = require('./communication-proposals');
const FIELDS = ['company','position','email'];
const array = value => Array.isArray(value) ? value : [];
const valueFor = (field,value) => field === 'email' ? normalizeEmail(value) : cleanText(value,200);
const same = (a,b) => cleanText(a).toLowerCase() === cleanText(b).toLowerCase();
const validEmail = value => value.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
function fail(message,statusCode=400) {const error=new Error(message);error.statusCode=statusCode;throw error;}

function sanitizeProfileUpdate(input) {
  const values={},expected={};
  for(const field of FIELDS) {
    const value=valueFor(field,input?.values?.[field]);
    if(value && (field!=='email' || validEmail(value))) values[field]=value;
    expected[field]=valueFor(field,input?.expected?.[field]);
  }
  return {values,expected,selected:[...new Set(array(input?.selected).filter(field=>FIELDS.includes(field)&&values[field]))],
    roleMode:input?.roleMode==='additional'?'additional':'primary',emailMode:input?.emailMode==='primary'?'primary':'additional'};
}

function buildProfileProposal(message,action,person) {
  // Signatures and account headers describe their author, never a copied recipient.
  if(!person?.contact || person.email!==message.sender.email) return null;
  const contact=person.contact, text=cleanText(message.profileText || message.bodyText), values={},evidence={};
  for(const field of ['company','position','email']) {
    const value=valueFor(field,action?.[field]);
    const quote=cleanText(action?.profileEvidence?.[field] || action?.evidence,700);
    if(!value || same(value,contact[field]) || (field==='email'&&!validEmail(value))) continue;
    if(!quote || !text.includes(quote) || !quote.toLowerCase().includes(value.toLowerCase())) continue;
    if(field==='email' && array(contact.emailAliases).some(address=>normalizeEmail(address)===value))continue;
    values[field]=value;evidence[field]=quote;
  }
  const senderEmail=normalizeEmail(person.email);
  if(array(contact.additionalRoles).some(role=>same(role.company,values.company || contact.company)
    && (!values.position || same(role.position,values.position)))) {delete values.company;delete values.position;delete evidence.company;delete evidence.position;}
  if(!values.email && validEmail(senderEmail) && senderEmail!==normalizeEmail(contact.email)
    && !array(contact.emailAliases).some(address=>normalizeEmail(address)===senderEmail)) {
    values.email=senderEmail;evidence.email=`From: ${senderEmail}`;
  }
  if(!Object.keys(values).length) return null;
  const sourceUrl=`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(message.sourceMessageId)}`;
  const id=String(contact.id);
  const sourceMessageId=`${message.sourceMessageId}:profile:${sourceHash('profile',id).slice(0,20)}`;
  const profileUpdate=sanitizeProfileUpdate({values,expected:contact,selected:Object.keys(values),
    roleMode:values.company && contact.company && !same(values.company,contact.company)?'additional':'primary',
    emailMode:contact.email?'additional':'primary'});
  return {source:'email',sourceMessageId,sourceHash:sourceHash('email',sourceMessageId),recipientEmail:senderEmail,
    occurredAt:message.receivedAt,proposalType:'update_contact',matchedContactId:id,
    evidence:Object.entries(evidence).map(([field,quote])=>`${field}: ${quote}`).join('\n'),
    proposed:{profileUpdate},reviewContext:{messageId:message.sourceMessageId,sourceUrl,subject:message.subject,
      profileEvidence:evidence,profileValues:values,matchMethod:person.matchMethod || '',profileUpdate:true}};
}

function profilePatch(contact,update,draft,now=new Date()) {
  const clean=sanitizeProfileUpdate(update);
  if(!clean.selected.length)fail('Select at least one profile field.');
  const observedAt=new Date(draft.occurred_at).toISOString();
  const confirmedAt=now.toISOString();
  const sourceKey=draft.review_context?.messageId || `communication:${draft.id}`;
  const currentSources=contact.profileFieldSources && typeof contact.profileFieldSources==='object' && !Array.isArray(contact.profileFieldSources)?contact.profileFieldSources:{};
  for(const field of clean.selected) {
    if(!same(contact[field] || '',clean.expected[field]))fail('Profile details changed after this suggestion. Review the current profile before applying.',409);
    const primary=field==='email'?clean.emailMode==='primary':clean.roleMode==='primary';
    if(primary && currentSources[field]?.observedAt && new Date(currentSources[field].observedAt)>new Date(observedAt)) {
      fail('A newer confirmed source already exists for this field. Keep this as additional information or ignore it.',409);
    }
  }
  const patch={},sources={...currentSources},before={},after={};
  const metadata=field=>({source:'email_review',messageId:sourceKey,proposalId:Number(draft.id),observedAt,confirmedAt,
    evidence:cleanText(draft.review_context?.profileEvidence?.[field],700),
    edited:!same(clean.values[field],draft.review_context?.profileValues?.[field] || draft.proposed?.profileUpdate?.values?.[field])});
  const roleFields=clean.selected.filter(field=>field!=='email');
  if(roleFields.length && clean.roleMode==='additional') {
    const role={company:roleFields.includes('company')?clean.values.company:contact.company || '',
      position:roleFields.includes('position')?clean.values.position:''};
    const roles=array(contact.additionalRoles);
    if(!roles.some(existing=>same(existing.company,role.company)&&same(existing.position,role.position))) {
      patch.additionalRoles=[...roles,{...role,source:{...metadata(roleFields[0]),evidence:roleFields.map(field=>metadata(field).evidence).filter(Boolean).join('\n')}}];
    }
  } else for(const field of roleFields) {
    if(!same(contact[field],clean.values[field])) {before[field]=contact[field] || '';after[field]=clean.values[field];patch[field]=clean.values[field];}
    sources[field]={...metadata(field),value:clean.values[field]};
  }
  if(clean.selected.includes('email')) {
    const address=clean.values.email;
    const aliases=array(contact.emailAliases).map(normalizeEmail).filter(validEmail);
    if(clean.emailMode==='primary') {
      if(contact.email && !same(contact.email,address))aliases.push(normalizeEmail(contact.email));
      before.email=contact.email || '';after.email=address;patch.email=address;
      sources.email={...metadata('email'),value:address};
    } else aliases.push(address);
    const primary=patch.email || contact.email;
    patch.emailAliases=[...new Set(aliases)].filter(alias=>alias!==normalizeEmail(primary));
    sources.emailAliases={...(currentSources.emailAliases || {}),[address]:{...metadata('email'),value:address}};
  }
  if(Object.keys(before).length) patch.profileHistory=[...array(contact.profileHistory),{sourceKey,before,after,observedAt,confirmedAt}];
  patch.profileFieldSources=sources;
  return patch;
}

async function applyProfileUpdate(sql,draft,proposed) {
  const rows=await sql`SELECT payload,version FROM crm_records WHERE record_type='contact' AND record_id=${String(draft.matched_contact_id)}
    AND COALESCE(payload->>'deleted','false')<>'true' AND COALESCE(payload->>'archived','false')<>'true'`;
  if(!rows.length)return null;
  const patch=profilePatch(rows[0].payload,proposed.profileUpdate,draft);
  const addresses=proposed.profileUpdate.selected.includes('email')?[proposed.profileUpdate.values.email]:[];
  const updated=await sql`WITH target AS MATERIALIZED (
    SELECT id FROM crm_communication_proposals WHERE id=${Number(draft.id)} AND status='pending' FOR UPDATE
  ), updated AS (
    UPDATE crm_records r SET payload=r.payload || ${JSON.stringify(patch)}::jsonb,version=r.version+1,updated_at=NOW()
    FROM target WHERE r.record_type='contact' AND r.record_id=${String(draft.matched_contact_id)} AND r.version=${Number(rows[0].version)}
      AND COALESCE(r.payload->>'deleted','false')<>'true' AND COALESCE(r.payload->>'archived','false')<>'true'
      AND NOT EXISTS (SELECT 1 FROM crm_records other WHERE other.record_type='contact' AND other.record_id<>r.record_id
        AND COALESCE(other.payload->>'deleted','false')<>'true' AND COALESCE(other.payload->>'archived','false')<>'true'
        AND (LOWER(COALESCE(other.payload->>'email',''))=ANY(${addresses}::text[])
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(other.payload->'emailAliases')='array' THEN other.payload->'emailAliases' ELSE '[]'::jsonb END) a WHERE LOWER(a.value)=ANY(${addresses}::text[]))))
    RETURNING r.record_id
  ), applied AS (
    UPDATE crm_communication_proposals SET status='applied',reviewed_at=NOW(),proposed=${JSON.stringify(proposed)}::jsonb
    WHERE id IN (SELECT id FROM target) AND EXISTS (SELECT 1 FROM updated) RETURNING id
  ) SELECT record_id AS contact_id FROM updated`;
  return updated[0]?.contact_id || null;
}

async function findContactByEmail(sql,email) {
  const address=normalizeEmail(email);
  if(!address)return null;
  const rows=await sql`SELECT record_id,payload FROM crm_records WHERE record_type='contact'
    AND COALESCE(payload->>'deleted','false')<>'true' AND COALESCE(payload->>'archived','false')<>'true'
    AND (LOWER(COALESCE(payload->>'email',''))=${address}
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(payload->'emailAliases')='array' THEN payload->'emailAliases' ELSE '[]'::jsonb END) a WHERE LOWER(a.value)=${address}))
    LIMIT 2`;
  return rows.length===1?{...rows[0].payload,id:rows[0].record_id}:null;
}

module.exports={sanitizeProfileUpdate,buildProfileProposal,profilePatch,applyProfileUpdate,findContactByEmail};
