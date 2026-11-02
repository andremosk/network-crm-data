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

  function dateOnly(value) {
    const date = text(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : '';
  }

  function money(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (value == null || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER / 100 ? Math.round(number * 100) / 100 : null;
  }

  function payments(value) {
    return (Array.isArray(value) ? value : []).filter(item => item && typeof item === 'object').map((item, index) => ({
      id: text(item.id || `payment-${index + 1}`), label: text(item.label),
      amount: money(item.amount), expectedDate: dateOnly(item.expectedDate),
      status: item.status === 'received' ? 'received' : 'expected'
    }));
  }

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
        ...(note.source ? { source: text(note.source), sourceKey: text(note.sourceKey), contactId: text(note.contactId) } : {}),
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
      projectedStartDate: dateOnly(item.projectedStartDate),
      projectedEndDate: dateOnly(item.projectedEndDate),
      expectedValue: money(item.expectedValue),
      payments: payments(item.payments),
      nextMilestone: text(item.nextMilestone || item.next_milestone),
      nextMilestoneDate: text(item.nextMilestoneDate || item.next_milestone_date).slice(0, 10),
      // A pursuit can belong to one shared group, but groups cannot nest.
      isGroup: item.isGroup === true || item.is_group === true || item.type === 'pursuit_group',
      groupId: text(item.groupId || item.group_id || item.pursuitGroupId),
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

  function forecastRows(items, activeOnly = true) {
    return sort(items).filter(item => !item.isGroup && !item.deleted && !item.archived &&
      (!activeOnly || !['closed', 'on_hold'].includes(item.status))).map(item => {
      const knownPayments = item.payments.filter(payment => payment.amount !== null);
      const plannedTotal = knownPayments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0) / 100;
      const expectedFees = item.expectedValue ?? (knownPayments.length ? plannedTotal : null);
      const outstanding = item.payments.filter(payment => payment.status !== 'received');
      const nextPayment = [...outstanding].sort((a, b) => (a.expectedDate || '9999').localeCompare(b.expectedDate || '9999'))[0];
      const unallocatedFees = expectedFees === null ? 0 : Math.max(0, Math.round((expectedFees - plannedTotal) * 100) / 100);
      const feesIncomplete = item.expectedValue === null && (!item.payments.length || item.payments.some(payment => payment.amount === null));
      return {...item, expectedFees, feesIncomplete, plannedTotal, unallocatedFees, outstanding, nextPayment};
    });
  }

  function cashFlow(rows) {
    const buckets = new Map();
    for (const row of rows) {
      if (row.unallocatedFees) {
        const bucket = buckets.get('Unscheduled') || {month: 'Unscheduled', amount: 0, unknown: 0};
        bucket.amount += Math.round(row.unallocatedFees * 100);
        buckets.set('Unscheduled', bucket);
      }
      for (const payment of row.outstanding) {
      const month = payment.expectedDate.slice(0, 7) || 'Unscheduled';
      const bucket = buckets.get(month) || {month, amount: 0, unknown: 0};
      if (payment.amount === null) bucket.unknown++;
      else bucket.amount += Math.round(payment.amount * 100);
      buckets.set(month, bucket);
      }
    }
    return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month)).map(bucket => ({...bucket, amount: bucket.amount / 100}));
  }

  function currency(value) {
    return value === null || value === undefined ? 'TBD' : new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 2}).format(value);
  }

  function paymentText(row) {
    const parts = row.payments.map(payment => `${payment.label || 'Payment'}: ${currency(payment.amount)} ${payment.status === 'received' ? 'received' : 'expected'} ${payment.expectedDate || '(date TBD)'}`);
    if (row.unallocatedFees) parts.push(`Unscheduled balance: ${currency(row.unallocatedFees)}`);
    return parts.join('; ') || 'Payment schedule TBD';
  }

  function recapCells(row) {
    return [row.title, row.organization, STATUS_LABELS[row.status], `${row.projectedStartDate || 'TBD'} to ${row.projectedEndDate || 'TBD'}`, currency(row.expectedFees) + (row.feesIncomplete && row.expectedFees !== null ? ' + TBD' : ''), paymentText(row), [row.nextMilestone, row.nextMilestoneDate].filter(Boolean).join(' - ')];
  }

  const FORECAST_HEADERS = ['Opportunity', 'Organization', 'Stage', 'Projected run', 'Expected fees (USD)', 'Payments (USD)', 'Next milestone'];
  function forecastCsv(rows) {
    const cell = value => {
      const raw = text(value);
      const safe = /^[\s]*[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    return [FORECAST_HEADERS, ...rows.map(recapCells)].map(row => row.map(cell).join(',')).join('\r\n');
  }

  function forecastRecap(rows) {
    const escape = value => text(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
    const style = 'padding:9px 10px;border:1px solid #dbe3df;text-align:left;vertical-align:top;font-size:12px;line-height:1.45;';
    const headers = ['Opportunity / client', 'Stage', 'Projected run', 'Fees (USD)', 'Receipts / timing', 'Next milestone'];
    const cells = row => { const values = recapCells(row); return [[values[0], values[1]].filter(Boolean).join(' / '), ...values.slice(2)]; };
    const html = `<div style="font-family:Arial,sans-serif;color:#20332d"><h3 style="font-size:16px;margin:0 0 10px">Opportunity forecast</h3><table style="border-collapse:collapse;width:100%"><thead><tr>${headers.map(label => `<th style="${style}background:#edf5f2">${escape(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${cells(row).map(value => `<td style="${style}">${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table><p style="font-size:11px;color:#596b63">Projected fees and receipts, not guaranteed revenue. TBD = not yet estimated.</p></div>`;
    return {html, text: 'Opportunity forecast\n\n' + rows.map(row => {
      const values = cells(row);
      return `${values[0]}\n${values[1]} | ${values[2]} | Fees: ${values[3]}\n${values[4]}\nNext milestone: ${values[5] || 'TBD'}`;
    }).join('\n\n') + '\n\nProjected fees and receipts, not guaranteed revenue. TBD = not yet estimated.'};
  }

  return { STATUSES, STATUS_LABELS, withDefaults, sort, normalizeContactIds, dateOnly, money, payments, forecastRows, cashFlow, currency, forecastCsv, forecastRecap };
});
