(function () {
  let pendingSummaries = [];
  const fullEmails = new Map();
  const loadingEmails = new Set();
  const openEmails = new Set();
  let engagementChoices = [];
  const summaryDestinations = new Map();
  const contactReviewUpdates = new Map();
  const reviewStatuses = [['network_closely', 'Network Closely'], ['network', 'Network Regularly'], ['came_through', 'Came Through'], ['follow_up', 'Follow Up'], ['call_scheduled', 'Call Scheduled'], ['interesting', 'Interesting'], ['recruiter', 'Recruiter'], ['cant_help', "Can't Help"]];

  function followUpPreset(period) {
    const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
    const date = new Date(`${today}T12:00:00Z`);
    if (period === 'week') date.setUTCDate(date.getUTCDate() + 7);
    else {
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + (period === 'quarter' ? 3 : 1));
      const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, last));
    }
    return date.toISOString().slice(0, 10);
  }

  function statusControls(key, prefix, current, suggested = {}) {
    const selected = contactReviewUpdates.get(key) || suggested;
    const status = selected.status || '';
    const currentLabel = current ? `${reviewStatuses.find(([value]) => value === current.status)?.[1] || 'No status'}${current.status === 'follow_up' && current.followUpDate ? ` · ${current.followUpDate}` : ''}` : '';
    return `<div class="communication-review-field"><label for="${prefix}_reviewStatus">Contact status${currentLabel ? ` <span class="text-review-meta">(current: ${escapeHtml(currentLabel)})</span>` : ''}</label><select class="form-input" id="${prefix}_reviewStatus" onchange="setReviewContactStatus('${key}','${prefix}',this.value)"><option value="">No change</option><option value="none" ${status === 'none' ? 'selected' : ''}>No status</option>${reviewStatuses.map(([value, label]) => `<option value="${value}" ${status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="communication-review-field"><label for="${prefix}_reviewDate">Follow-up date</label><input class="form-input" type="date" id="${prefix}_reviewDate" value="${escapeHtml(selected.followUpDate || '')}" onchange="setReviewFollowUpDate('${key}','${prefix}',this.value)"></div>
      <div class="communication-review-field wide review-follow-up-presets" role="group" aria-label="Follow-up timing"><button type="button" class="btn btn-ghost btn-sm" onclick="setReviewFollowUpPreset('${key}','${prefix}','week')">1 week</button><button type="button" class="btn btn-ghost btn-sm" onclick="setReviewFollowUpPreset('${key}','${prefix}','month')">1 month</button><button type="button" class="btn btn-ghost btn-sm" onclick="setReviewFollowUpPreset('${key}','${prefix}','quarter')">3 months</button></div>`;
  }

  window.setReviewContactStatus = function(key, prefix, status) {
    const field = document.getElementById(`${prefix}_reviewDate`);
    const followUpDate = status === 'follow_up' ? (field?.value || followUpPreset('week')) : '';
    contactReviewUpdates.set(key, {status, followUpDate});
    if (field) field.value = followUpDate;
  };
  window.setReviewFollowUpDate = function(key, prefix, date) {
    const statusField = document.getElementById(`${prefix}_reviewStatus`);
    const status = date ? 'follow_up' : (statusField?.value || '');
    if (statusField) statusField.value = status;
    contactReviewUpdates.set(key, {status, followUpDate: date});
  };
  window.setReviewFollowUpPreset = function(key, prefix, period) {
    const date = followUpPreset(period);
    const field = document.getElementById(`${prefix}_reviewDate`);
    if (field) field.value = date;
    window.setReviewFollowUpDate(key, prefix, date);
  };
  let pendingConversations = [];
  let pendingProposals = [];
  let pendingCreateKey = null;
  let contactChoices = new Map();
  let emailReviewStatus = null;
  let emailReviewBusy = "";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Recent exchange";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function emailTimestamps(item) {
    const stamp = value => {
      if (!value) return 'Unknown';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'Unknown';
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year:'numeric', month:'short', day:'numeric',
        hour:'numeric', minute:'2-digit', timeZoneName:'short'
      }).format(date);
    };
    const received = item.occurred_at;
    const queued = item.created_at;
    const older = received && queued && new Date(queued) - new Date(received) > 86400000;
    return `<div class="text-review-meta">Email received: ${escapeHtml(stamp(received))}</div>
      <div class="text-review-meta">Added to review: ${escapeHtml(stamp(queued))}${older ? ' · Older email surfaced during review' : ''}</div>`;
  }

  function allContacts() {
    try {
      return Array.isArray(contacts) ? contacts : [];
    } catch {
      return [];
    }
  }

  function contactById(id) {
    return allContacts().find((contact) => String(contact.id) === String(id));
  }

  function summariesForContact(contactId) {
    return pendingSummaries.filter((item) => String(item.contact_id) === String(contactId));
  }

  function ensureTextReviewUi() {
    if (!document.getElementById("textReviewStyles")) {
      const style = document.createElement("style");
      style.id = "textReviewStyles";
      style.textContent = `
        .text-review-trigger { position:relative; min-width:42px; padding:7px 10px; }
        .text-review-badge { position:absolute; top:-6px; right:-6px; min-width:18px; height:18px; padding:0 5px; display:none; align-items:center; justify-content:center; border:2px solid var(--surface); border-radius:9px; background:#b44b4b; color:#fff; font-size:10px; font-weight:700; }
        .text-review-badge.visible { display:inline-flex; }
        .text-review-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
        .text-review-header-actions { display:flex; gap:7px; align-items:center; }
        .text-review-section-title { gap:10px; flex-wrap:wrap; overflow-wrap:anywhere; }
        .communication-review-field { min-width:0; }
        .text-review-header-actions button[disabled] { cursor:wait; opacity:.65; }
        .email-review-status { margin:-5px 0 14px; padding:9px 11px; border:1px solid var(--border); border-radius:6px; background:var(--surface2); color:var(--muted); font-size:12px; line-height:1.45; }
        .email-review-status.error { border-color:#e6c1c1; background:#fff7f7; color:#a33f3f; }
        .text-review-section { padding:14px 0; border-top:1px solid var(--border); }
        .text-review-section:first-of-type { border-top:0; }
        .text-review-section-title { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; font-size:12px; font-weight:700; }
        .text-review-list { border-top:1px solid var(--border); }
        .text-review-row { padding:14px 0; border-bottom:1px solid var(--border); }
        .text-review-row-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        .text-review-name { font-size:14px; font-weight:700; }
        .text-review-meta { color:var(--muted); font-size:11px; margin-top:2px; }
        .text-review-controls { display:grid; grid-template-columns:minmax(180px,1fr) auto; gap:8px; margin-top:10px; }
        .text-review-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:7px; margin-top:9px; }
        .text-review-empty { padding:30px 10px; text-align:center; color:var(--muted); font-size:13px; }
        .text-review-contact { color:var(--muted); font-size:12px; }
        .text-review-summary { width:100%; min-height:74px; margin-top:9px; resize:vertical; padding:10px 12px; border:1px solid var(--border); border-radius:7px; background:var(--surface2); color:var(--text); font:13px/1.55 'DM Sans',sans-serif; outline:none; }
        .text-review-summary:focus { border-color:var(--accent); }
        .communication-review-labels { display:flex; flex-wrap:wrap; gap:6px; margin-top:5px; }
        .communication-review-label { padding:2px 7px; border:1px solid var(--border); border-radius:4px; color:var(--muted); font-size:10px; font-weight:700; text-transform:uppercase; }
        .communication-review-evidence { margin-top:10px; color:var(--text); font-size:13px; line-height:1.55; }
        .communication-full-email { margin:12px 0; border:1px solid var(--border); border-radius:6px; padding:12px; }
        .communication-full-email summary { cursor:pointer; font-weight:600; font-size:13px; }
        .communication-email-headers { margin:12px 0; font-size:12px; line-height:1.6; overflow-wrap:anywhere; }
        .communication-email-body { white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; line-height:1.65; }
        .profile-details { overflow-wrap:anywhere; }
        .communication-review-fields { margin-top:10px; padding:12px; border:1px solid var(--border); border-radius:7px; background:var(--surface2); }
        .communication-review-fields summary { cursor:pointer; color:var(--muted); font-size:11px; font-weight:700; }
        .communication-review-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; }
        .communication-review-grid .wide { grid-column:1 / -1; }
        .communication-review-field label { display:block; margin-bottom:4px; color:var(--muted); font-size:10px; font-weight:700; text-transform:uppercase; }
        .review-follow-up-presets { display:flex; flex-wrap:wrap; gap:6px; }
        @media (max-width:700px) {
          .text-review-header { flex-direction:column; }
          .text-review-header-actions { flex-wrap:wrap; }
          .text-review-trigger { grid-column:auto; grid-row:auto; }
          .text-review-controls { grid-template-columns:1fr; }
          .text-review-actions { justify-content:flex-start; }
          .communication-review-grid { grid-template-columns:1fr; }
          .communication-review-grid .wide { grid-column:auto; }
        }
      `;
      document.head.appendChild(style);
    }

    if (!document.getElementById("textReviewBtn")) {
      const button = document.createElement("button");
      button.id = "textReviewBtn";
      button.className = "btn btn-ghost text-review-trigger";
      button.title = "Communication Review";
      button.setAttribute("aria-label", "Open Communication Review");
      button.innerHTML = `<span aria-hidden="true">💬</span><span class="text-review-badge" id="textReviewBadge"></span>`;
      button.onclick = window.openTextReview;
      const anchor = document.getElementById("ghSyncBar");
      anchor?.parentNode?.insertBefore(button, anchor);
    }

    if (!document.getElementById("textReviewModal")) {
      const modal = document.createElement("div");
      modal.className = "modal-overlay";
      modal.id = "textReviewModal";
      modal.onclick = (event) => { if (event.target === modal) window.closeTextReview(); };
      modal.innerHTML = `<div class="modal" style="width:720px;max-height:90vh" id="textReviewContent"></div>`;
      document.body.appendChild(modal);
    }
  }

  function updateBadge() {
    ensureTextReviewUi();
    const count = pendingSummaries.length + pendingConversations.length + pendingProposals.length;
    const badge = document.getElementById("textReviewBadge");
    if (badge) {
      badge.textContent = String(count);
      badge.classList.toggle("visible", count > 0);
    }
    const button = document.getElementById("textReviewBtn");
    if (button) button.title = count ? `Communication Review · ${count} pending` : "Communication Review";
  }

  function buildContactChoices() {
    contactChoices = new Map();
    return allContacts()
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map((contact) => {
        const display = `${contact.name || "Unknown"}${contact.company ? ` — ${contact.company}` : ""} [${contact.id}]`;
        contactChoices.set(display, contact.id);
        return `<option value="${escapeHtml(display)}"></option>`;
      })
      .join("");
  }

  function renderConversation(item) {
    return `<div class="text-review-row">
      <div class="text-review-row-head">
        <div>
          <div class="text-review-name">${escapeHtml(item.participant_label)}</div>
          <div class="text-review-meta">Latest text ${escapeHtml(formatDate(item.latest_message_at))}</div>
          <div class="communication-review-labels"><span class="communication-review-label">SMS</span><span class="communication-review-label">Create contact</span></div>
        </div>
      </div>
      <div class="text-review-controls">
        <input class="form-input" id="textMatch_${item.conversation_key}" list="textReviewContacts" placeholder="Search existing contacts">
        <button class="btn btn-primary btn-sm" onclick="matchTextConversation('${item.conversation_key}')">Match</button>
      </div>
      <div class="text-review-actions">
        <button class="btn btn-ghost btn-sm" onclick="createContactFromText('${item.conversation_key}')">Create Contact</button>
        <button class="btn btn-ghost btn-sm" onclick="reviewTextConversation('${item.conversation_key}','dismiss')">Not CRM Relevant</button>
        <button class="btn btn-ghost btn-sm" onclick="reviewTextConversation('${item.conversation_key}','ignore')">Always Ignore</button>
      </div>
    </div>`;
  }

  function destinationFor(item) {
    return summaryDestinations.get(Number(item.id)) || (item.suggested_engagement_id ? `engagement:${item.suggested_engagement_id}` : 'contact');
  }

  function destinationControl(item) {
    const selected = destinationFor(item);
    const match=contactById(item.contact_id);
    const choice=match?`${match.name || 'Unknown'}${match.company?` — ${match.company}`:''} [${match.id}]`:'';
    return `<label class="form-group"><span class="form-label">Save to</span><select class="form-input" aria-label="Note destination" onchange="setTextSummaryDestination(${item.id},this.value,this)"><option value="contact" ${selected === 'contact' ? 'selected' : ''}>Contact notes</option>${engagementChoices.map(engagement => `<option value="engagement:${escapeHtml(engagement.id)}" ${selected === `engagement:${engagement.id}` ? 'selected' : ''}>Engagement: ${escapeHtml(engagement.title || engagement.organization)}</option>`).join('')}</select></label>${item.conversation_context?.isGroup ? `<label class="form-group" data-group-contact style="${selected === 'contact' ? '' : 'display:none'}"><span class="form-label">Contact</span><input class="form-input" id="groupContact_${item.id}" list="textReviewContacts" placeholder="Choose a contact" aria-label="Group note contact" value="${escapeHtml(choice)}"></label>` : ''}`;
  }

  window.setTextSummaryDestination = function(id, value, select) {
    summaryDestinations.set(Number(id), value);
    const button = select.closest('.text-review-row')?.querySelector('[data-approve-summary]');
    if (button) button.textContent = value === 'contact' ? 'Add to Contact Notes' : 'Add to Engagement';
    const contactField = select.closest('.text-review-row')?.querySelector('[data-group-contact]');
    if (contactField) contactField.style.display = value === 'contact' ? '' : 'none';
    const statusFields = select.closest('.text-review-row')?.querySelector('[data-review-contact-status]');
    if (statusFields) statusFields.style.display = value === 'contact' ? '' : 'none';
  };

  function renderSummary(item, prefix = 'textReviewSummary') {
    const contact = contactById(item.contact_id);
    const group = item.conversation_context?.isGroup ? item.conversation_context : null;
    const participant=group?.analysisVersion===2?group.members?.find(member=>member.key===group.participantKey):null;
    return `<div class="text-review-row">
      <div class="text-review-row-head">
        <div>
          <div class="text-review-name" id="smsParticipantName_${item.id}">${escapeHtml(participant?participant.contactName || participant.label:group ? group.title : contact?.name || "CRM contact")}</div>
          <div class="text-review-meta">${escapeHtml(formatDate(item.conversation_ended_at))} · ${participant?(group.evidenceMessages || []).length:Number(item.message_count) || 0} ${participant?'source messages':'messages'}</div>
          ${participant?`<div class="text-review-meta">${escapeHtml(participant.handle || participant.label)} · ${smsMatchLabel(participant.matchMethod)}</div>`:group ? `<div class="text-review-meta">Speakers: ${escapeHtml(group.participants.join(', '))}</div>` : ''}
          <div class="communication-review-labels"><span class="communication-review-label">${group ? 'Group SMS' : 'SMS'}</span></div>
        </div>
        <div class="text-review-contact">${group ? 'Choose destination' : 'Ready for Notes'}</div>
      </div>
      ${destinationControl(item)}
      <div class="communication-review-grid" data-review-contact-status style="${destinationFor(item) === 'contact' ? '' : 'display:none'}">${statusControls(`sms:${item.id}`, `${prefix}_${item.id}`, contact)}</div>
      ${participant && /^(phone:|email:)/.test(participant.key)?`<label class="text-review-meta"><input type="checkbox" id="rememberSmsParticipant_${item.id}" checked> Remember number/address match when saving to contact</label>`:''}
      ${participant?`<details class="communication-full-email"><summary>Messages used for this update</summary>${(group.evidenceMessages || []).map(message=>`<div class="communication-review-evidence"><strong>${escapeHtml(message.senderKey==='self'?'Andre':group.members.find(member=>member.key===message.senderKey)?.contactName || message.senderLabel)}</strong><div class="text-review-meta">${escapeHtml(formatDate(message.at))}</div><div class="communication-email-body">${escapeHtml(message.body)}</div></div>`).join('')}</details>`:''}
      <textarea class="text-review-summary" id="${prefix}_${item.id}" aria-label="Edit text summary">${escapeHtml(item.summary)}</textarea>
      <div class="text-review-actions">
        <button class="btn btn-ghost btn-sm" onclick="dismissTextSummary(${item.id})">Dismiss</button>
        <button class="btn btn-primary btn-sm" data-approve-summary onclick="approveTextSummary(${item.id},'${escapeHtml(String(item.contact_id))}','${prefix}')">${destinationFor(item) === 'contact' ? 'Add to Contact Notes' : 'Add to Engagement'}</button>
      </div>
    </div>`;
  }

  function smsMatchLabel(method) {
    return ({confirmed:'Confirmed match',number_or_email:'Phone / email match',name:'Name suggestion',ambiguous:'Ambiguous match',unmatched:'Needs a match'})[method] || 'Needs a match';
  }

  function renderSmsGroups() {
    const groups=new Map();
    for(const item of pendingSummaries) {
      const context=item.conversation_context;
      const key=context?.analysisVersion===2?context.rootSourceKey:`single:${item.id}`;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
    }
    return [...groups.values()].map(items=>{
      const first=items[0],context=first.conversation_context;
      if(context?.analysisVersion!==2)return items.map(item=>renderSummary(item)).join('');
      return `<section class="text-review-section"><div class="text-review-section-title">${escapeHtml(context.title)} · ${items.length} participant update${items.length===1?'':'s'}</div>
        <details class="communication-full-email" open><summary>Participants & contact matches</summary>${context.members.map((member,index)=>{
          const contact=contactById(member.contactId),choice=contact?`${contact.name}${contact.company?` — ${contact.company}`:''} [${contact.id}]`:'';
          return `<div class="text-review-row"><strong>${escapeHtml(member.label)}</strong>${member.handle && member.handle!==member.label?` <span class="text-review-meta">${escapeHtml(member.handle)}</span>`:''}<div class="text-review-meta" id="smsMemberStatus_${first.id}_${index}">${smsMatchLabel(member.matchMethod)} · ${member.messageCount || 0} new message${member.messageCount===1?'':'s'}</div><div class="text-review-controls"><input class="form-input" id="smsMemberMatch_${first.id}_${index}" list="textReviewContacts" value="${escapeHtml(choice)}" placeholder="Choose contact" aria-label="Contact for ${escapeHtml(member.label)}"><button class="btn btn-ghost btn-sm" onclick="matchSmsParticipant(${first.id},${index})" title="${/^(phone:|email:)/.test(member.key)?'Confirm participant identity':'No raw number or address in this export'}" ${/^(phone:|email:)/.test(member.key)?'':'disabled'}>Save match</button></div></div>`;
        }).join('')}</details>${items.map(item=>renderSummary(item)).join('')}</section>`;
    }).join('');
  }

  window.matchSmsParticipant=async function(id,index) {
    try {
      const member=pendingSummaries.find(item=>Number(item.id)===Number(id))?.conversation_context?.members?.[index];
      if(!member || !/^(phone:|email:)/.test(member.key))return;
      buildContactChoices();
      const contactId=contactChoices.get(document.getElementById(`smsMemberMatch_${id}_${index}`)?.value || '');
      if(contactId==null)throw Error('Choose an existing contact for this participant.');
      await patchReview({resource:'participant',id,participantKey:member.key,contactId:String(contactId)});
      const contact=contactById(contactId),choice=`${contact.name}${contact.company?` — ${contact.company}`:''} [${contact.id}]`;
      // Update only identity controls; do not replace any draft summary editors.
      for(const item of pendingSummaries) {
        const context=item.conversation_context;
        context?.members?.forEach((entry,position)=>{
          if(entry.key!==member.key)return;
          Object.assign(entry,{contactId:String(contactId),contactName:contact.name,matchMethod:'confirmed'});
          const input=document.getElementById(`smsMemberMatch_${item.id}_${position}`);if(input)input.value=choice;
          const status=document.getElementById(`smsMemberStatus_${item.id}_${position}`);if(status)status.textContent=`Confirmed match · ${entry.messageCount || 0} new message${entry.messageCount===1?'':'s'}`;
        });
        if(context?.participantKey===member.key) {
          item.contact_id=String(contactId);
          const input=document.getElementById(`groupContact_${item.id}`);if(input)input.value=choice;
          const name=document.getElementById(`smsParticipantName_${item.id}`);if(name)name.textContent=contact.name;
        }
      }
      window.toast?.('Participant match saved');
    } catch(error){window.toast?.(error.message);}
  };

  function proposalTypeLabel(type) {
    return ({create_contact:'Create contact',update_contact:'Update contact',create_engagement:'Create pursuit',update_engagement:'Update engagement'})[type] || 'No CRM action';
  }

  function renderProposal(item) {
    const proposed = item.proposed || {};
    const create = item.proposal_type === "create_contact";
    const engagement = item.proposal_type.endsWith('_engagement');
    if (engagement) return renderEngagementProposal(item);
    if(proposed.profileUpdate) return renderProfileProposal(item);
    const displayName = create ? proposed.name : (item.matched_contact_name || "CRM contact");
    const field = (id, label, value, extra = "") => `<div class="communication-review-field ${extra}"><label for="comm_${id}_${item.id}">${label}</label><input class="form-input" ${id.endsWith('Date') ? 'type="date"' : ''} id="comm_${id}_${item.id}" value="${escapeHtml(value)}"></div>`;
    return `<div class="text-review-row" id="communicationProposal_${item.id}">
      <div class="text-review-row-head">
        <div>
          <div class="text-review-name">${escapeHtml(displayName)}</div>
          ${emailTimestamps(item)}
          ${item.recipient_email ? `<div class="text-review-meta">${escapeHtml(item.recipient_email)}</div>` : ''}
          <div class="communication-review-labels"><span class="communication-review-label">Email</span><span class="communication-review-label">${proposalTypeLabel(item.proposal_type)}</span></div>
        </div>
        <div class="text-review-contact">Awaiting approval</div>
      </div>
      <div class="communication-review-evidence">${escapeHtml(item.evidence)}</div>
      ${item.review_context?.matchMethod === 'unique_name' ? '<div class="text-review-meta">Name match · verify contact before applying</div>' : ''}
      <details class="communication-review-fields" open>
        <summary>Proposed CRM fields</summary>
        <div class="communication-review-grid">
          ${create ? `${field("name", "Name", proposed.name)}${field("email", "Email", proposed.email)}${field("company", "Company", proposed.company)}${field("position", "Position", proposed.position)}
          <div class="communication-review-field"><label for="comm_tier_${item.id}">Relationship</label><select class="form-input" id="comm_tier_${item.id}">${[1,2,3,4].map((tier) => `<option value="${tier}" ${Number(proposed.tier) === tier ? "selected" : ""}>T${tier}</option>`).join("")}</select></div>` : ""}
          ${!create && proposed.email ? field("email", "Email to save", proposed.email, "wide") : ""}
          ${statusControls(`email:${item.id}`, `comm_${item.id}`, contactById(item.matched_contact_id), proposed.contactUpdate || proposed)}
          ${proposed.reminder ? `${field('reminderDate','Referral reminder date', proposed.reminder.date)}${field('reminderText','Reminder',proposed.reminder.text, 'wide')}` : ''}
          ${proposed.nextAction ? field('nextAction','Next action',proposed.nextAction,'wide') : ''}
          <div class="communication-review-field wide"><label for="comm_note_${item.id}">Initial note</label><textarea class="text-review-summary" id="comm_note_${item.id}">${escapeHtml(proposed.notes || proposed.note)}</textarea></div>
        </div>
      </details>
      <div class="text-review-actions">
        <button class="btn btn-ghost btn-sm" onclick="ignoreCommunicationProposal(${item.id})">Ignore</button>
        <button class="btn btn-ghost btn-sm" onclick="editCommunicationProposal(${item.id})">Save Edit</button>
        ${item.proposal_type !== "no_action" ? `<button class="btn btn-primary btn-sm" onclick="applyCommunicationProposal(${item.id})">${create ? "Create" : "Apply"}</button>` : ""}
      </div>
    </div>`;
  }

  function renderProfileProposal(item) {
    const update=item.proposed.profileUpdate;
    const fields=Object.keys(update.values || {}).filter(field=>['company','position','email'].includes(field));
    const labels={company:'Company',position:'Title',email:'Email'};
    return `<div class="text-review-row" id="communicationProposal_${item.id}">
      <div class="text-review-row-head"><div><div class="text-review-name">${escapeHtml(item.matched_contact_name || 'CRM contact')}</div>
      <div class="communication-review-labels"><span class="communication-review-label">Profile update</span><span class="communication-review-label">${item.review_context?.matchMethod === 'unique_name'?'Name match':'Email match'}</span></div>${emailTimestamps(item)}</div><div class="text-review-contact">Awaiting approval</div></div>
      <div class="communication-review-evidence">${escapeHtml(item.evidence)}</div>
      <div class="communication-review-grid">${fields.map(field=>`<div class="communication-review-field wide">
        <label><input type="checkbox" id="comm_profileSelect_${field}_${item.id}" ${update.selected.includes(field)?'checked':''}> ${labels[field]}</label>
        <div class="text-review-meta">Saved when proposed: ${escapeHtml(update.expected[field] || 'Not set')}</div>
        <input class="form-input" id="comm_profile_${field}_${item.id}" aria-label="Proposed ${labels[field]}" value="${escapeHtml(update.values[field])}"></div>`).join('')}
      ${fields.some(field=>field!=='email')?`<div class="communication-review-field wide"><label for="comm_roleMode_${item.id}">Role destination</label><select class="form-input" id="comm_roleMode_${item.id}"><option value="additional" ${update.roleMode==='additional'?'selected':''}>Additional role — keep primary company and title</option><option value="primary" ${update.roleMode==='primary'?'selected':''}>Primary company / title — keep previous values in history</option></select></div>`:''}
      ${fields.includes('email')?`<div class="communication-review-field wide"><label for="comm_emailMode_${item.id}">Address destination</label><select class="form-input" id="comm_emailMode_${item.id}"><option value="additional" ${update.emailMode==='additional'?'selected':''}>Additional address — keep primary email</option><option value="primary" ${update.emailMode==='primary'?'selected':''}>Primary email — keep previous address as an alias</option></select></div>`:''}
      </div><div class="text-review-actions"><button class="btn btn-ghost btn-sm" onclick="ignoreCommunicationProposal(${item.id})">Ignore</button><button class="btn btn-ghost btn-sm" onclick="editCommunicationProposal(${item.id})">Save Edit</button><button class="btn btn-primary btn-sm" onclick="applyCommunicationProposal(${item.id})">Apply selected fields</button></div></div>`;
  }

  function renderEngagementProposal(item) {
    const p = item.proposed || {};
    const field = (key, label, value, textarea = false) => `<div class="communication-review-field ${textarea ? 'wide' : ''}"><label for="comm_${key}_${item.id}">${label}</label>${textarea ? `<textarea class="text-review-summary" id="comm_${key}_${item.id}">${escapeHtml(value)}</textarea>` : `<input class="form-input" ${key.endsWith('Date') ? 'type="date"' : ''} id="comm_${key}_${item.id}" value="${escapeHtml(value)}">`}</div>`;
    return `<div class="text-review-row" id="communicationProposal_${item.id}"><div class="text-review-row-head"><div><div class="text-review-name">${escapeHtml(p.title || p.organization || 'Engagement')}</div><div class="communication-review-labels"><span class="communication-review-label">Email</span><span class="communication-review-label">${proposalTypeLabel(item.proposal_type)}</span></div></div><div class="text-review-contact">Awaiting approval</div></div>
      ${emailTimestamps(item)}
      <div class="communication-review-evidence">${escapeHtml(item.evidence)}</div>
      <details class="communication-review-fields" open><summary>Proposed engagement fields</summary><div class="communication-review-grid">
      <div class="communication-review-field wide"><label for="comm_engagementId_${item.id}">Destination</label><select class="form-input" id="comm_engagementId_${item.id}">${item.proposal_type === 'create_engagement' ? '<option value="">New pursuit</option>' : ''}${engagementChoices.map(e => `<option value="${escapeHtml(e.id)}" ${String(e.id) === String(p.engagementId) ? 'selected' : ''}>${escapeHtml(e.title)}${e.organization ? ` · ${escapeHtml(e.organization)}` : ''}</option>`).join('')}</select></div>
      ${field('title','Title',p.title)}${field('organization','Organization',p.organization)}${field('currentState','Current state',p.currentState,true)}${field('opportunity','Opportunity / problem',p.opportunity,true)}${field('nextMilestone','Next milestone',p.nextMilestone)}${field('nextMilestoneDate','Milestone date',p.nextMilestoneDate)}${field('note','Timeline note',p.note,true)}
      </div></details><div class="text-review-actions"><button class="btn btn-ghost btn-sm" onclick="ignoreCommunicationProposal(${item.id})">Ignore</button><button class="btn btn-ghost btn-sm" onclick="editCommunicationProposal(${item.id})">Save Edit</button><button class="btn btn-primary btn-sm" onclick="applyCommunicationProposal(${item.id})">${item.proposal_type === 'create_engagement' ? 'Create / Apply' : 'Apply'}</button></div></div>`;
  }

  window.loadFullReviewEmail = async function(id, details) {
    if (!details.open) { openEmails.delete(id); return; }
    openEmails.add(id);
    const slot = document.getElementById(`fullReviewEmail_${id}`);
    if (!slot) return;
    if (fullEmails.has(id)) { slot.innerHTML = fullEmails.get(id); return; }
    if (loadingEmails.has(id)) return;
    loadingEmails.add(id);
    slot.innerHTML = '<div class="text-review-meta" role="status">Loading full email…</div>';
    try {
      const response = await fetch(`/api/crm/communication-email?proposalId=${encodeURIComponent(id)}`, {cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Could not load the full email.');
      const email = data.email;
      const date = new Date(email.receivedAt);
      const received = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-US', {timeZone:'America/New_York',timeZoneName:'short'});
      const headers = [['From',email.from],['To',email.to],['Cc',email.cc],['Received',received],['Subject',email.subject]]
        .filter(([,value]) => value).map(([label,value]) => `<div><strong>${label}:</strong> ${escapeHtml(value)}</div>`).join('');
      const html = `<div class="communication-email-headers">${headers}</div><div class="communication-email-body">${escapeHtml(email.body || '(No text body)')}</div>`;
      fullEmails.set(id,html);
      const current = document.getElementById(`fullReviewEmail_${id}`);
      if (current) current.innerHTML = html;
    } catch (error) {
      const current = document.getElementById(`fullReviewEmail_${id}`);
      if (current) current.innerHTML = `<div class="text-review-meta" role="alert">${escapeHtml(error.message)}</div><button class="btn btn-ghost btn-sm" onclick="loadFullReviewEmail(${id},{open:true})">Retry</button>`;
    } finally { loadingEmails.delete(id); }
  };

  function renderEmailGroups() {
    const groups = new Map();
    for (const item of pendingProposals) {
      const key = item.review_context?.messageId || `legacy:${item.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return [...groups.values()].map(items => {
      const context = items[0].review_context;
      const url = context?.sourceUrl && /^https:\/\/mail\.google\.com\//.test(context.sourceUrl) ? context.sourceUrl : '';
      const id = items[0].id;
      const source = `<details class="communication-full-email" ${openEmails.has(id) ? 'open' : ''} ontoggle="loadFullReviewEmail(${id},this)"><summary>Full email</summary><div id="fullReviewEmail_${id}">${fullEmails.get(id) || ''}</div></details>`;
      return `<section class="text-review-section">${context?.messageId ? `<div class="text-review-section-title"><span>${escapeHtml(context.subject || 'Business email')} · ${items.length} proposed action${items.length === 1 ? '' : 's'}</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open in Gmail</a>` : ''}</div>` : ''}${source}${items.map(renderProposal).join('')}</section>`;
    }).join('');
  }

  function renderTextReviewModal() {
    ensureTextReviewUi();
    const content = document.getElementById("textReviewContent");
    if (!content) return;
    const total = pendingSummaries.length + pendingConversations.length + pendingProposals.length;
    content.innerHTML = `<div class="text-review-header">
      <div><h2 style="margin:0">Communication Review</h2><div class="text-summary-subtitle">Review SMS and email proposals before changing the CRM</div></div>
      <div class="text-review-header-actions"><button class="btn btn-ghost btn-sm" id="checkEmailButton" onclick="refreshEmailReview()" ${emailReviewBusy ? "disabled" : ""}>${emailReviewBusy === "review" ? "Checking…" : "Check email"}</button><button class="btn btn-ghost btn-sm" id="findEmailsButton" onclick="enrichContactEmails()" ${emailReviewBusy ? "disabled" : ""}>${emailReviewBusy === "enrichment" ? "Searching…" : "Find missing emails"}</button><button class="btn btn-ghost btn-sm" onclick="closeTextReview()" aria-label="Close">×</button></div>
    </div>
    ${emailReviewStatus ? `<div class="email-review-status ${emailReviewStatus.kind === "error" ? "error" : ""}" id="emailReviewStatus">${escapeHtml(emailReviewStatus.message)}</div>` : ""}
    ${total ? `
      ${pendingConversations.length ? `<section class="text-review-section"><div class="text-review-section-title"><span>Needs matching</span><span>${pendingConversations.length}</span></div><div class="text-review-list">${pendingConversations.map(renderConversation).join("")}</div></section>` : ""}
      ${pendingSummaries.length ? `<section class="text-review-section"><div class="text-review-section-title"><span>Summary review</span><span>${pendingSummaries.length}</span></div><div class="text-review-list">${renderSmsGroups()}</div></section>` : ""}
      ${pendingProposals.length ? `<section class="text-review-section"><div class="text-review-section-title"><span>Email proposals</span><span>${pendingProposals.length}</span></div><div class="text-review-list">${renderEmailGroups()}</div></section>` : ""}
      <datalist id="textReviewContacts">${buildContactChoices()}</datalist>
    ` : `<div class="text-review-empty">No communications need attention.</div>`}`;
  }

  function profileDetails(contact) {
    if(!contact)return '';
    const aliases=Array.isArray(contact.emailAliases)?contact.emailAliases:[];
    const roles=Array.isArray(contact.additionalRoles)?contact.additionalRoles:[];
    const history=Array.isArray(contact.profileHistory)?contact.profileHistory:[];
    const sources=contact.profileFieldSources || {};
    const sourceLabel=source=>source?.confirmedAt?` · ${source.edited?'Approved edit':'Email reviewed'} ${escapeHtml(formatDate(source.confirmedAt))}${source.observedAt?` · observed ${escapeHtml(formatDate(source.observedAt))}`:''}${source.messageId && !String(source.messageId).startsWith('communication:')?` · <a href="https://mail.google.com/mail/u/0/#all/${escapeHtml(encodeURIComponent(source.messageId))}" target="_blank" rel="noopener noreferrer">Source email</a>`:''}`:'';
    const primary=['company','position','email'].filter(field=>sources[field]).map(field=>`<div class="text-review-meta">${({company:'Company',position:'Title',email:'Email'})[field]}${sourceLabel(sources[field])}</div>`).join('');
    if(!aliases.length&&!roles.length&&!history.length&&!primary)return '';
    return `<section class="text-summary-review profile-details"><div class="sec-title">Profile details</div>${primary}
      ${aliases.length?`<div style="margin-top:10px"><strong>Additional email addresses</strong>${aliases.map(address=>`<div>${escapeHtml(address)}<span class="text-review-meta">${sourceLabel(sources.emailAliases?.[address])}</span></div>`).join('')}</div>`:''}
      ${roles.length?`<div style="margin-top:10px"><strong>Additional roles</strong>${roles.map(role=>`<div>${escapeHtml([role.position,role.company].filter(Boolean).join(' · '))}<span class="text-review-meta">${sourceLabel(role.source)}</span></div>`).join('')}</div>`:''}
      ${history.length?`<details style="margin-top:10px"><summary>Previous profile values</summary>${[...history].reverse().map(entry=>`<div class="text-review-meta" style="margin-top:8px">${escapeHtml(formatDate(entry.confirmedAt))}: ${Object.keys(entry.before || {}).map(field=>`${escapeHtml(field)}: ${escapeHtml(entry.before[field] || 'Not set')} → ${escapeHtml(entry.after?.[field] || '')}`).join(' · ')}</div>`).join('')}</details>`:''}</section>`;
  }

  window.renderTextSummarySection = function renderTextSummarySection(contactId) {
    const items = summariesForContact(contactId);
    const reminders = contactById(contactId)?.communicationReminders || [];
    const reminderHtml = reminders.length ? `<section class="text-summary-review"><div class="sec-title">Referral follow-ups</div>${reminders.map(reminder => `<div class="text-review-row"><strong>${escapeHtml(reminder.date)}</strong> · ${escapeHtml(reminder.text)}</div>`).join('')}</section>` : '';
    const profileHtml=profileDetails(contactById(contactId));
    if (!items.length) return profileHtml + reminderHtml;
    return profileHtml + reminderHtml + `<section class="text-summary-review" aria-label="Text summaries awaiting review">
      <div class="text-summary-heading"><div><div class="sec-title" style="margin:0">Text summaries</div><div class="text-summary-subtitle">Review before adding these to Notes</div></div><span class="text-summary-count">${items.length}</span></div>
      ${items.map(item => renderSummary(item, 'textSummary')).join("")}
    </section>`;
  };

  window.renderEngagementTextSummaries = function(id) {
    const items = pendingSummaries.filter(item => destinationFor(item) === `engagement:${id}`);
    return items.length ? `<section class="text-summary-review"><div class="sec-title">SMS awaiting review</div>${items.map(item => renderSummary(item, 'engagementTextSummary')).join('')}</section>` : '';
  };

  function updateEngagementReview() {
    const slot = document.getElementById('engagementSmsReview');
    if (slot) slot.innerHTML = window.renderEngagementTextSummaries(slot.dataset.engagementId);
  }

  window.loadTextSummaries = async function loadTextSummaries() {
    try {
      const [textResponse, proposalResponse] = await Promise.all([
        fetch("/api/crm/text-summaries", { cache: "no-store" }),
        fetch("/api/crm/communication-proposals", { cache: "no-store" })
      ]);
      if (textResponse.status === 401 || proposalResponse.status === 401) return;
      const [data, proposalData] = await Promise.all([
        textResponse.json().catch(() => ({})), proposalResponse.json().catch(() => ({}))
      ]);
      if (!textResponse.ok) throw new Error(data.error?.message || "Could not load Communication Review.");
      if (!proposalResponse.ok) throw new Error(proposalData.error?.message || "Could not load email proposals.");
      pendingSummaries = Array.isArray(data.summaries) ? data.summaries : [];
      engagementChoices = Array.isArray(data.engagements) ? data.engagements : [];
      pendingConversations = Array.isArray(data.conversations) ? data.conversations : [];
      pendingProposals = Array.isArray(proposalData.proposals) ? proposalData.proposals : [];
      updateBadge();
      updateEngagementReview();
      if (document.getElementById("textReviewModal")?.classList.contains("open")) renderTextReviewModal();
      const current = [
        ...pendingConversations.map(item => `conversation:${item.conversation_key}`),
        ...pendingSummaries.map(item => `sms:${item.id}`),
        ...pendingProposals.map(item => `email:${item.id}`)
      ];
      let seen = [];
      try { seen = JSON.parse(localStorage.getItem('network_crm_communication_notice') || '[]'); } catch {}
      if (!Array.isArray(seen)) seen = [];
      const known = new Set(seen);
      const added = current.filter(id => !known.has(id));
      localStorage.setItem('network_crm_communication_notice', JSON.stringify([...new Set([...seen, ...current])].slice(-1500)));
      if (added.length && typeof window.toast === 'function') {
        window.toast(`${added.length} new SMS or email item${added.length === 1 ? '' : 's'} in Communication Review`);
      }
    } catch (error) {
      console.warn("Communication Review unavailable:", error);
    }
  };

  window.openTextReview = async function openTextReview() {
    ensureTextReviewUi();
    document.getElementById("textReviewModal")?.classList.add("open");
    renderTextReviewModal();
    await window.loadTextSummaries();
  };

  window.closeTextReview = function closeTextReview() {
    document.getElementById("textReviewModal")?.classList.remove("open");
  };

  window.refreshEmailReview = async function refreshEmailReview() {
    if (emailReviewBusy) return;
    emailReviewBusy = "review";
    emailReviewStatus = { kind: "info", message: "Checking recent email for business and relationship updates…" };
    renderTextReviewModal();
    try {
      const response = await fetch("/api/crm/gmail-review-sync", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || "Could not check Gmail.");
      await window.loadTextSummaries();
      const scanned = Number(data.scanned) || 0;
      const skipped = Number(data.skipped) || 0;
      const duplicates = Number(data.duplicates) || 0;
      const more = data.has_more ? ' More emails remain. Click Check email again for the next batch.' : ' This scan is complete.';
      emailReviewStatus = {
        kind: "info",
        message: data.proposed
          ? `${data.proposed} email proposal${data.proposed === 1 ? " is" : "s are"} ready for review. Checked ${scanned} recent email${scanned === 1 ? "" : "s"}.`
          : `Checked ${scanned} recent email${scanned === 1 ? "" : "s"}. ${skipped} had no useful business or relationship update${duplicates ? `; ${duplicates} were already reviewed` : ""}.`
      };
      emailReviewStatus.message += more;
      if (data.retry_pending) emailReviewStatus.message += ` ${Number(data.retry_pending)} email(s) awaiting another assessment attempt; they are not discarded.`;
      if (typeof window.toast === "function") {
        if (data.proposed) {
          window.toast(`${data.proposed} email proposal${data.proposed === 1 ? "" : "s"} ready for review (${scanned} checked)`);
        } else if (scanned) {
          window.toast(`Checked ${scanned} recent emails. No new proposals (${skipped} skipped by the review rules).`);
        } else {
          window.toast("No recent inbox emails found to review.");
        }
      }
    } catch (error) {
      const message = /quota|rate limit/i.test(error.message)
        ? "Gmail is temporarily rate-limited. Try again in about a minute; no CRM records were changed."
        : error.message;
      emailReviewStatus = { kind: "error", message };
      if (typeof window.toast === "function") window.toast(message);
    } finally {
      emailReviewBusy = "";
      renderTextReviewModal();
    }
  };

  window.enrichContactEmails = async function enrichContactEmails() {
    if (emailReviewBusy) return;
    emailReviewBusy = "enrichment";
    emailReviewStatus = { kind: "info", message: "Searching a small archive batch for unique email matches. Suggestions always require review." };
    renderTextReviewModal();
    try {
      const response = await fetch("/api/crm/gmail-email-enrichment", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || "Could not look for missing emails.");
      await window.loadTextSummaries();
      const suffix = data.completed ? " Email archive scan complete." : " More archive messages remain; run again for the next batch.";
      const scanned = Number(data.scanned) || 0;
      const duplicates = Number(data.duplicates) || 0;
      emailReviewStatus = {
        kind: "info",
        message: data.proposed
          ? `${data.proposed} email suggestion${data.proposed === 1 ? " is" : "s are"} ready for review from ${scanned} archive message${scanned === 1 ? "" : "s"}.${suffix}`
          : `No new email suggestions from ${scanned} archive message${scanned === 1 ? "" : "s"}${duplicates ? `; ${duplicates} was already queued` : ""}.${suffix}`
      };
      if (typeof window.toast === "function") {
        window.toast(data.proposed ? `${data.proposed} email suggestion${data.proposed === 1 ? "" : "s"} ready for review.${suffix}` : `No new email suggestions.${suffix}`);
      }
    } catch (error) {
      const message = /quota|rate limit/i.test(error.message)
        ? "Gmail is temporarily rate-limited. Try again in about a minute; no CRM records were changed."
        : error.message;
      emailReviewStatus = { kind: "error", message };
      if (typeof window.toast === "function") window.toast(message);
    } finally {
      emailReviewBusy = "";
      renderTextReviewModal();
    }
  };

  async function patchReview(body) {
    const response = await fetch("/api/crm/text-summaries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || "Could not update Communication Review.");
    return data;
  }

  async function patchCommunicationReview(body) {
    const response = await fetch("/api/crm/communication-proposals", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || "Could not update Communication Review.");
    return data;
  }

  function proposalFromEditor(id) {
    const item = pendingProposals.find((candidate) => Number(candidate.id) === Number(id));
    if (!item) return null;
    const value = (name) => document.getElementById(`comm_${name}_${id}`)?.value.trim() || "";
    if(item.proposed?.profileUpdate) return {profileUpdate:{...item.proposed.profileUpdate,
      values:Object.fromEntries(Object.keys(item.proposed.profileUpdate.values).map(field=>[field,value(`profile_${field}`)])),
      selected:Object.keys(item.proposed.profileUpdate.values).filter(field=>document.getElementById(`comm_profileSelect_${field}_${id}`)?.checked),
      roleMode:value('roleMode') || item.proposed.profileUpdate.roleMode,emailMode:value('emailMode') || item.proposed.profileUpdate.emailMode}};
    if (item.proposal_type.endsWith('_engagement')) return { ...item.proposed,
      ...Object.fromEntries(['engagementId','title','organization','currentState','opportunity','nextMilestone','nextMilestoneDate','note'].map(key => [key, value(key)])) };
    const manual = contactReviewUpdates.get(`email:${id}`) || item.proposed?.contactUpdate;
    const common = { note: value("note"), notes: value("note"), email: value("email"), status: manual ? null : item.proposed?.status, followUpDate: manual ? '' : item.proposed?.followUpDate || '', lastContact: item.proposed?.lastContact || "", ...(manual ? {contactUpdate: manual} : {}),
      ...(item.proposed?.reminder ? {reminder:{date:value('reminderDate'),text:value('reminderText')}} : {}),
      ...(item.proposed?.nextAction ? {nextAction:value('nextAction')} : {}) };
    return item.proposal_type === "create_contact" ? {
      ...common, name: value("name"), email: value("email"), company: value("company"), position: value("position"), tier: Number(value("tier")) || 3
    } : common;
  }

  async function completeCommunicationProposal(id, action) {
    const proposed = proposalFromEditor(id);
    const data = await patchCommunicationReview({ id, action, proposed });
    if (action !== "edit") pendingProposals = pendingProposals.filter((item) => Number(item.id) !== Number(id));
    else {
      const item = pendingProposals.find((candidate) => Number(candidate.id) === Number(id));
      if (item) item.proposed = data.proposal || proposed;
    }
    updateBadge();
    renderTextReviewModal();
    return data;
  }

  window.editCommunicationProposal = async function editCommunicationProposal(id) {
    try {
      await completeCommunicationProposal(id, "edit");
      if (typeof window.toast === "function") window.toast("Proposal edits saved");
    } catch (error) { if (typeof window.toast === "function") window.toast(error.message); }
  };

  window.ignoreCommunicationProposal = async function ignoreCommunicationProposal(id) {
    try {
      await completeCommunicationProposal(id, "ignore");
      if (typeof window.toast === "function") window.toast("Communication ignored");
    } catch (error) { if (typeof window.toast === "function") window.toast(error.message); }
  };

  window.applyCommunicationProposal = async function applyCommunicationProposal(id) {
    try {
      const data = await completeCommunicationProposal(id, "apply");
      if (typeof window.refreshCloudState === "function") await window.refreshCloudState();
      if (typeof window.toast === "function") window.toast(data.status === "applied" ? "CRM proposal applied" : "Proposal updated");
    } catch (error) { if (typeof window.toast === "function") window.toast(error.message); }
  };

  window.reviewTextConversation = async function reviewTextConversation(key, action, contactId) {
    try {
      await patchReview({ resource: "conversation", key, action, contactId });
      pendingConversations = pendingConversations.filter((item) => item.conversation_key !== key);
      updateBadge();
      renderTextReviewModal();
      if (typeof window.toast === "function") window.toast(action === "match" ? "Text conversation matched" : action === "ignore" ? "Conversation will stay ignored" : "Conversation dismissed until a new text");
    } catch (error) {
      if (typeof window.toast === "function") window.toast(error.message);
    }
  };

  window.matchTextConversation = function matchTextConversation(key) {
    buildContactChoices();
    const value = document.getElementById(`textMatch_${key}`)?.value || "";
    const contactId = contactChoices.get(value);
    if (!contactId) {
      if (typeof window.toast === "function") window.toast("Choose a contact from the list");
      return;
    }
    window.reviewTextConversation(key, "match", contactId);
  };

  window.createContactFromText = function createContactFromText(key) {
    const item = pendingConversations.find((candidate) => candidate.conversation_key === key);
    if (!item) return;
    pendingCreateKey = key;
    const words = String(item.participant_label || "").trim().split(/\s+/);
    document.getElementById("nFirst").value = words.shift() || "";
    document.getElementById("nLast").value = words.join(" ");
    window.closeTextReview();
    if (typeof window.openAddContactModal === "function") window.openAddContactModal();
  };

  window.completeTextContactCreation = function completeTextContactCreation(contactId) {
    if (!pendingCreateKey) return;
    const key = pendingCreateKey;
    pendingCreateKey = null;
    setTimeout(() => window.reviewTextConversation(key, "match", contactId), 2200);
  };

  async function reviewSummary(id, action, summary, engagementId, contactId, contactUpdate,rememberParticipant) {
    const data = await patchReview({ id, action, summary, engagementId, contactId, contactUpdate,rememberParticipant });
    pendingSummaries = pendingSummaries.filter((item) => Number(item.id) !== Number(id));
    updateBadge();
    renderTextReviewModal();
    updateEngagementReview();
    return data;
  }

  window.approveTextSummary = async function approveTextSummary(id, contactId, prefix = 'textReviewSummary') {
    const editor = document.getElementById(`${prefix}_${id}`);
    const summary = editor?.value.trim() || "";
    if (!summary) return;
    try {
      const item = pendingSummaries.find(item => Number(item.id) === Number(id));
      const destination = destinationFor(item || { id });
      const engagementId = destination.startsWith('engagement:') ? destination.slice(11) : undefined;
      if (item?.conversation_context?.isGroup && !engagementId) {
        buildContactChoices();
        contactId = contactChoices.get(document.getElementById(`groupContact_${id}`)?.value || '');
        if (contactId==null) throw new Error('Choose a contact from the list or select an engagement.');
      }
      await reviewSummary(id, "approve", summary, engagementId, contactId, engagementId ? undefined : contactReviewUpdates.get(`sms:${id}`),
        !engagementId && Boolean(document.getElementById(`rememberSmsParticipant_${id}`)?.checked));
      if (typeof window.refreshCloudState === "function") await window.refreshCloudState();
      if (!document.getElementById("textReviewModal")?.classList.contains("open")) {
        if (engagementId && typeof window.openEngagementDetail === 'function') {
          window.switchView('engagements');
          window.openEngagementDetail(engagementId);
        } else if (typeof window.openDetail === 'function') window.openDetail(Number(contactId));
      }
      if (typeof window.toast === "function") window.toast(engagementId ? "SMS added to engagement" : "SMS added to contact notes");
    } catch (error) {
      if (typeof window.toast === "function") window.toast(error.message);
    }
  };

  window.dismissTextSummary = async function dismissTextSummary(id) {
    try {
      await reviewSummary(id, "dismiss");
      if (typeof window.toast === "function") window.toast("Text summary dismissed");
    } catch (error) {
      if (typeof window.toast === "function") window.toast(error.message);
    }
  };

  ensureTextReviewUi();
})();
