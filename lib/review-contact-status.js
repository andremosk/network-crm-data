const CONTACT_STATUSES = new Set(['network_closely', 'network', 'came_through', 'follow_up', 'call_scheduled', 'interesting', 'recruiter', 'cant_help']);

function contactStatusPatch(value) {
  if (value == null) return {};
  const fail = message => { const error = new Error(message); error.statusCode = 400; throw error; };
  if (typeof value !== 'object' || Array.isArray(value)) fail('Invalid contact status update.');
  const status = value.status;
  if (status === '' || status == null) {
    if (value.followUpDate) fail('Choose Follow Up before setting a follow-up date.');
    return {};
  }
  if (status !== 'none' && !CONTACT_STATUSES.has(status)) fail('Invalid contact status.');
  const date = value.followUpDate || '';
  if (typeof date !== 'string' || (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date))) {
    fail('Enter a valid follow-up date.');
  }
  if (status !== 'follow_up' && date) fail('Follow-up dates require Follow Up status.');
  const patch = {status: status === 'none' ? null : status, followUp: status === 'follow_up'};
  if (status !== 'follow_up' || Object.hasOwn(value, 'followUpDate')) patch.followUpDate = status === 'follow_up' ? date : '';
  return patch;
}

module.exports = { contactStatusPatch };
