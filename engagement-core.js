(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EngagementCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STATUSES = [
    ['pursuit', 'Pursuit'],
    ['discovery', 'Discovery'],
    ['proposal', 'Proposal'],
    ['active_client', 'Active Client'],
    ['on_hold', 'On Hold'],
    ['closed', 'Closed']
  ];

  const STATUS_LABELS = Object.fromEntries(STATUSES);

  function text(value) {
    return typeof value === 'string' ? value : value == null ? '' : String(value);
  }

  function normalizeContactIds(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(id => Number(id) || text(id).trim()).filter(Boolean))];
  }

  function normalizeNotes(value, fallbackDate) {
    if (Array.isArray(value)) {
      return value.map((note, index) => ({
        id: note.id || `note-${index + 1}`,
        date: text(note.date || fallbackDate),
        html: text(note.html || note.text)
      })).filter(note => note.html.trim());
    }
    if (text(value).trim()) {
      return [{ id: 'note-1', date: text(fallbackDate), html: text(value) }];
    }
    return [];
  }

  function withDefaults(value) {
    const item = value || {};
    const createdDate = text(item.createdDate || item.created_date || '').slice(0, 10);
    const rawStatus = text(item.status || 'pursuit').toLowerCase().replace(/[\s-]+/g, '_');
    return {
      ...item,
      id: Number(item.id) || item.id,
      title: text(item.title),
      organization: text(item.organization || item.client),
      status: STATUS_LABELS[rawStatus] ? rawStatus : 'pursuit',
      currentState: text(item.currentState || item.current_state),
      opportunity: text(item.opportunity || item.problem),
      commercial: text(item.commercial || item.commercialHypothesis || item.estimate),
      nextMilestone: text(item.nextMilestone || item.next_milestone),
      nextMilestoneDate: text(item.nextMilestoneDate || item.next_milestone_date).slice(0, 10),
      contactIds: normalizeContactIds(item.contactIds || item.linkedContactIds),
      links: Array.isArray(item.links) ? item.links.join('\n') : text(item.links),
      notes: normalizeNotes(item.notes, createdDate),
      createdDate,
      updatedDate: text(item.updatedDate || item.updated_date || createdDate).slice(0, 10)
    };
  }

  function compare(a, b) {
    const left = withDefaults(a);
    const right = withDefaults(b);
    const leftClosed = left.status === 'closed' ? 1 : 0;
    const rightClosed = right.status === 'closed' ? 1 : 0;
    if (leftClosed !== rightClosed) return leftClosed - rightClosed;
    const leftMissingDate = left.nextMilestoneDate ? 0 : 1;
    const rightMissingDate = right.nextMilestoneDate ? 0 : 1;
    if (leftMissingDate !== rightMissingDate) return leftMissingDate - rightMissingDate;
    if (left.nextMilestoneDate !== right.nextMilestoneDate) {
      return left.nextMilestoneDate.localeCompare(right.nextMilestoneDate);
    }
    return left.title.localeCompare(right.title);
  }

  function sort(items) {
    return (items || []).map(withDefaults).sort(compare);
  }

  return { STATUSES, STATUS_LABELS, withDefaults, sort, normalizeContactIds };
});
