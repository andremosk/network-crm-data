const { withDefaults } = require("../engagement-core");

function activeEngagements(items) {
  return items.map(withDefaults).filter(item => !item.deleted && !item.archived && item.status !== "closed");
}

function companyKey(value) {
  return String(value || "").toLowerCase().replace(/\b(incorporated|inc|llc|ltd|corporation|corp)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function relatedEngagements(contact, items) {
  const company = companyKey(contact.company);
  return activeEngagements(items).filter(item =>
    item.contactIds.some(id => String(id) === String(contact.id)) ||
    (company && company === companyKey(item.organization)));
}

function suggestEngagement(contact, summary, items) {
  const related = relatedEngagements(contact, items).filter(item => item.status !== "on_hold");
  const work = /\b(project|deliverable|dashboard|prototype|scope|invoice|receivables|payables|ar\/ap|ap\/ar|implementation|deployment|rollout|vendor|integration|connector|power bi|business central|bc cloud|on.prem|curriculum|proposal|nda|milestone|profitability|client work)\b/i;
  if (!work.test(summary)) return null;
  if (related.length === 1) return String(related[0].id);
  const named = related.filter(item => summary.toLowerCase().includes(item.title.toLowerCase()) && item.title.trim());
  return named.length === 1 ? String(named[0].id) : null;
}

module.exports = { activeEngagements, relatedEngagements, suggestEngagement };
