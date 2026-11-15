const DISTRICT = /\b(?:school[- ]districts?|public school systems?|district (?:hr|human resources|administrators?|superintendents?)|(?:school )?superintendents?|(?:k[-– ]?12 )?district leaders)\b/i;
const DISTRICT_EMPLOYER = /\b(?:school district|public schools|board of education|department of education|union free school|central school district|isd|ufsd|csd)\b/i;
const RULES = [
  ['Education', /\b(?:education|schools?|k[-– ]?12|academ(?:y|ies)|university|college|charter schools?)\b/i],
  ['Healthcare', /\b(?:healthcare|health care|health services|hospitals?|clinics?|dental|medical|health systems?)\b/i],
  ['Financial services', /\b(?:bank(?:ing|s)?|credit unions?|financial services|insurance|wealth management|private equity|investment banking)\b/i],
  ['Manufacturing', /\b(?:manufactur\w*|fabricat\w*|metals|industrial production|components|plastics|factory)\b/i],
  ['Construction', /\b(?:construction|contractors?|builders?|roofing|plumbing|electricians?)\b/i],
  ['Technology', /\b(?:software|saas|technolog\w*|cybersecurity|cloud computing)\b/i],
  ['Professional services', /\b(?:consulting|advisory|accounting|law firm|law offices|legal services|fractional)\b/i],
  ['Nonprofit', /\b(?:non[- ]?profits?|charit\w*|foundations?)\b/i],
  ['Retail', /\b(?:retail\w*|department stores?|supermarkets?|grocery)\b/i],
  ['Media', /\b(?:media|broadcast\w*|entertainment|publishing|streaming)\b/i],
  ['Distribution', /\b(?:distribut\w*|wholesal\w*|logistics|freight)\b/i],
  ['Government', /\b(?:government|municipal\w*|city of|county of|town of|public sector)\b/i]
];
const KNOWN = [
  ['Technology', /^(?:ibm|microsoft|google|alphabet|salesforce|snap(?: inc)?|meta(?: platforms)?|oracle)(?:\s|$)/i],
  ['Financial services', /^(?:j\s*p\s*morgan(?: chase)?|citi(?:group|bank)?|goldman sachs|bank of america|wells fargo|morgan stanley)(?:\s|$)/i],
  ['Media', /^(?:netflix|disney|warner bros|nbcuniversal)(?:\s|$)/i],
  ['Retail', /^(?:walmart|costco|rack room shoes|hunter bell)(?:\s|$)/i],
  ['Professional services', /^(?:huron|point b|deloitte|accenture|pwc|kpmg|ernst & young|ey)(?:\s|$)/i]
];

function inferEmployer(company) {
  const name = String(company || '').trim().replace(/\./g, '').replace(/\s+/g, ' ');
  const orgType = /\bcharter\b/i.test(name) ? 'Charter school/network'
    : /\b(?:university|college)\b/i.test(name) ? 'Higher education'
      : DISTRICT_EMPLOYER.test(name) ? 'Public school district/system' : '';
  const known = KNOWN.find(([, pattern]) => pattern.test(name));
  const inferred = RULES.filter(([, pattern]) => pattern.test(name));
  const industry = orgType ? 'Education' : known?.[0] || (inferred.length === 1 ? inferred[0][0] : '');
  return { industry, orgType, source: industry ? 'Inferred' : 'Unknown' };
}

function industryScope(query) {
  if (DISTRICT.test(query)) return [{ label: 'Public school districts', industry: 'Education', orgType: 'Public school district/system', pattern: DISTRICT }];
  const scopeText = query.replace(/\b(?:technology|software)\s+(?:roll[ -]?out|deployment|implementation|migration|upgrade)\b/gi, '');
  return RULES.filter(([, pattern]) => pattern.test(scopeText)).map(([industry,pattern]) => ({ label: industry, industry, pattern }));
}

function accessEvidence(text, name, scopes) {
  const first = String(name || '').trim().split(/\s+/)[0].toLowerCase();
  const access = /\b(?:introduc(?:e[ds]?|ing)|connect(?:ed|s|ing)?|referr(?:ed|ing)|advis(?:es?|ed|ing)|work(?:s|ed|ing)? (?:closely |directly )?with|serv(?:es?|ed|ing)|clients include|network (?:of|includes)|partner(?:s|ed|ing)? with)\b/i;
  return text.split(/[,;.!?]|\b(?:but|while|however)\b/i).some(clause => {
    if (scopes.length && !scopes.some(scope => scope.pattern.test(clause))) return false;
    const match = clause.match(access);
    if (!match) return false;
    const subject = clause.slice(0, match.index).trim().replace(/^(?:[A-Za-z]{3,9} +\d{1,2}(?:, *\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?):\s*/,'');
    // A generic "connected me" is not evidence when the sentence credits someone else.
    if (!subject) return true;
    const prefix = subject.toLowerCase().replace(/\s+(?:can|could|has|have|regularly|often)$/,'');
    if (first && [first, String(name).toLowerCase()].includes(prefix)) return true;
    // Allow a role description only if it is anchored to this contact by name.
    return Boolean(first && (prefix.startsWith(first + ' is ') || prefix.startsWith(String(name).toLowerCase() + ' is '))
      && /\bworking with$/i.test(match[0]) && !/\b(?:not|never|and)\b/i.test(prefix));
  });
}

module.exports = { inferEmployer, industryScope, accessEvidence };
