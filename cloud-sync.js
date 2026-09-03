(function () {
  const CLOUD_CURSOR_KEY = 'andre_crm_cloud_cursor';
  let cloudSyncCursor = localStorage.getItem(CLOUD_CURSOR_KEY) || '';

  function payload(record) {
    const data = { ...(record || {}) };
    Object.keys(data).forEach((key) => { if (key.startsWith('_sync')) delete data[key]; });
    return data;
  }

  function fingerprint(record) {
    return JSON.stringify(payload(record));
  }

  function setStatus(state, label) {
    const bar = document.getElementById('ghSyncBar');
    const dot = document.getElementById('ghSyncDot');
    const text = document.getElementById('ghSyncLabel');
    if (!bar || !dot || !text) return;
    bar.className = `gh-sync-bar cloud-active ${state || ''}`.trim();
    dot.className = `gh-sync-dot ${state === 'syncing' ? 'pulse' : ''}`.trim();
    text.textContent = label || (state === 'synced' ? 'Cloud synced' : state === 'error' ? 'Cloud offline' : 'Cloud ready');
  }

  function showLogin() {
    const overlay = document.getElementById('cloudLoginOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    setTimeout(() => document.getElementById('cloudLoginToken')?.focus(), 50);
  }

  window.signInToCloud = async function signInToCloud() {
    const input = document.getElementById('cloudLoginToken');
    const button = document.getElementById('cloudLoginBtn');
    const error = document.getElementById('cloudLoginError');
    const token = input.value.trim();
    if (!token) { error.textContent = 'Enter your access key.'; return; }
    button.disabled = true;
    button.textContent = 'Opening...';
    error.textContent = '';
    try {
      const response = await fetch('/api/crm/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || 'Sign-in failed.');
      input.value = '';
      document.getElementById('cloudLoginOverlay').style.display = 'none';
      await pullState(true);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Continue';
    }
  };

  function rememberState() {
    cloudContactVersions = new Map();
    cloudContactFingerprints = new Map();
    cloudAppVersions = new Map();
    cloudAppFingerprints = new Map();
    cloudEngagementVersions = new Map();
    cloudEngagementFingerprints = new Map();
    contacts.forEach((contact) => {
      cloudContactVersions.set(String(contact.id), Number(contact._syncVersion || 0));
      cloudContactFingerprints.set(String(contact.id), fingerprint(contact));
    });
    apps.forEach((app) => {
      cloudAppVersions.set(String(app.id), Number(app._syncVersion || 0));
      cloudAppFingerprints.set(String(app.id), fingerprint(app));
    });
    engagements.forEach((engagement) => {
      cloudEngagementVersions.set(String(engagement.id), Number(engagement._syncVersion || 0));
      cloudEngagementFingerprints.set(String(engagement.id), fingerprint(engagement));
    });
  }

  async function pullState(initial = false) {
    if (cloudSyncTimer || cloudSaveInFlight || cloudPullInFlight) return;
    if (!initial && localStorage.getItem('andre_crm_local_dirty')) {
      queueCloudRetry();
      return;
    }
    const revisionAtStart = cloudLocalRevision;
    cloudPullInFlight = true;
    setStatus('syncing', 'Loading cloud...');
    try {
      const stateUrl = cloudSyncCursor
        ? `/api/crm/state?since=${encodeURIComponent(cloudSyncCursor)}`
        : '/api/crm/state';
      const response = await fetch(stateUrl, { cache: 'no-store' });
      if (response.status === 401) {
        cloudSyncReady = false;
        showLogin();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || 'Could not load cloud CRM.');
      const isDelta = data.mode === 'delta';
      if (!Array.isArray(data.contacts) || (!isDelta && data.contacts.length < 100)) throw new Error('Cloud CRM is not initialized yet.');
      if (!window.CloudSyncCore.shouldApplyPull(revisionAtStart, cloudLocalRevision, !!cloudSyncTimer, cloudSaveInFlight)) {
        setStatus('syncing', 'Saving...');
        return;
      }
      if (isDelta) {
        contacts = window.CloudSyncCore.mergeRemoteRecords(contacts, data.contacts, data.deletedContacts, withFitDefaults);
        apps = window.CloudSyncCore.mergeRemoteRecords(apps, data.apps, data.deletedApps, (app) => ({ statusLog: [], ...app }));
        engagements = window.CloudSyncCore.mergeRemoteRecords(engagements, data.engagements, data.deletedEngagements, window.EngagementCore.withDefaults);
      } else {
        contacts = data.contacts.map(withFitDefaults);
        apps = Array.isArray(data.apps) ? data.apps.map((app) => ({ statusLog: [], ...app })) : apps;
        engagements = Array.isArray(data.engagements)
          ? data.engagements.map(window.EngagementCore.withDefaults)
          : engagements;
      }
      rememberState();
      cloudSyncReady = true;
      localStorage.setItem('andre_crm_v2', JSON.stringify(contacts));
      localStorage.setItem('andre_apps_v1', JSON.stringify(apps));
      localStorage.setItem('andre_engagements_v1', JSON.stringify(engagements));
      if (typeof data.syncedAt === 'string' && !Number.isNaN(Date.parse(data.syncedAt))) {
        cloudSyncCursor = data.syncedAt;
        localStorage.setItem(CLOUD_CURSOR_KEY, cloudSyncCursor);
      }
      localStorage.removeItem('andre_crm_local_dirty');
      if (currentView === 'contacts') renderList();
      else if (currentView === 'apps') renderApps();
      else renderEngagements();
      setStatus('synced', 'Cloud synced');
      if (initial && !cloudPollTimer) {
        cloudPollTimer = setInterval(() => {
          if (!document.hidden && cloudSyncReady && !cloudSyncTimer && !cloudSaveInFlight) {
            pullState().catch(() => setStatus('error', 'Cloud offline'));
          }
        }, 5 * 60 * 1000);
      }
      if (typeof window.loadTextSummaries === 'function') await window.loadTextSummaries();
    } finally {
      cloudPullInFlight = false;
    }
  }

  window.refreshCloudState = function refreshCloudState() {
    return pullState(false);
  };

  function changedRecords(records, versions, fingerprints) {
    return window.CloudSyncCore.changedRecords(records, versions, fingerprints, payload, fingerprint);
  }

  function deletedRecords(records, versions) {
    const currentIds = new Set(records.map((record) => String(record.id)));
    return [...versions.entries()]
      .filter(([id]) => !currentIds.has(id))
      .map(([id, version]) => ({ id, version }));
  }

  function queueCloudRetry() {
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(flushState, 250);
  }

  window.queueCloudSync = function queueCloudSync() {
    if (!cloudSyncReady) return;
    cloudLocalRevision += 1;
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    setStatus('syncing', 'Saving...');
    cloudSyncTimer = setTimeout(flushState, 900);
  };

  async function flushState() {
    cloudSyncTimer = null;
    if (cloudSaveInFlight) {
      queueCloudRetry();
      return;
    }
    cloudSaveInFlight = true;
    const revisionAtStart = cloudLocalRevision;
    const requestBody = {
      contacts: changedRecords(contacts, cloudContactVersions, cloudContactFingerprints),
      apps: changedRecords(apps, cloudAppVersions, cloudAppFingerprints),
      engagements: changedRecords(engagements, cloudEngagementVersions, cloudEngagementFingerprints),
      deletedContacts: deletedRecords(contacts, cloudContactVersions),
      deletedApps: deletedRecords(apps, cloudAppVersions),
      deletedEngagements: deletedRecords(engagements, cloudEngagementVersions)
    };
    if (!requestBody.contacts.length && !requestBody.apps.length && !requestBody.engagements.length && !requestBody.deletedContacts.length && !requestBody.deletedApps.length && !requestBody.deletedEngagements.length) {
      cloudSaveInFlight = false;
      setStatus('synced', 'Cloud synced');
      return;
    }
    try {
      const response = await fetch('/api/crm/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      if (response.status === 401) {
        cloudSyncReady = false;
        showLogin();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || 'Cloud save failed.');
      const contactChanges = window.CloudSyncCore.applyResults(contacts, cloudContactVersions, cloudContactFingerprints, data.contacts, requestBody.contacts, fingerprint);
      const appChanges = window.CloudSyncCore.applyResults(apps, cloudAppVersions, cloudAppFingerprints, data.apps, requestBody.apps, fingerprint);
      const engagementChanges = window.CloudSyncCore.applyResults(engagements, cloudEngagementVersions, cloudEngagementFingerprints, data.engagements, requestBody.engagements, fingerprint);
      for (const remap of contactChanges.remaps) {
        if (String(selectedId) === remap.requestedId) selectedId = Number(remap.assignedId) || remap.assignedId;
      }
      for (const remap of appChanges.remaps) {
        if (String(selectedAppId) === remap.requestedId) selectedAppId = Number(remap.assignedId) || remap.assignedId;
      }
      for (const remap of engagementChanges.remaps) {
        if (String(selectedEngagementId) === remap.requestedId) selectedEngagementId = Number(remap.assignedId) || remap.assignedId;
      }
      if (contactChanges.conflicts.length || appChanges.conflicts.length || engagementChanges.conflicts.length) {
        toast('A newer cloud edit was kept. Please review this record.');
      }
      const deletions = [...(data.deletedContacts || []), ...(data.deletedApps || []), ...(data.deletedEngagements || [])];
      if (deletions.some((item) => item.status === 'conflict')) {
        await pullState();
        return;
      }
      (data.deletedContacts || []).forEach((item) => {
        if (item.status === 'deleted') {
          cloudContactVersions.delete(String(item.id));
          cloudContactFingerprints.delete(String(item.id));
        }
      });
      (data.deletedApps || []).forEach((item) => {
        if (item.status === 'deleted') {
          cloudAppVersions.delete(String(item.id));
          cloudAppFingerprints.delete(String(item.id));
        }
      });
      (data.deletedEngagements || []).forEach((item) => {
        if (item.status === 'deleted') {
          cloudEngagementVersions.delete(String(item.id));
          cloudEngagementFingerprints.delete(String(item.id));
        }
      });
      localStorage.setItem('andre_crm_v2', JSON.stringify(contacts));
      localStorage.setItem('andre_apps_v1', JSON.stringify(apps));
      localStorage.setItem('andre_engagements_v1', JSON.stringify(engagements));
      if (currentView === 'contacts') {
        renderList();
        if (selectedId !== null && document.getElementById('detailPanel')?.classList.contains('open')) openDetail(selectedId);
      } else if (currentView === 'apps') {
        renderApps();
        if (selectedAppId !== null && document.getElementById('appDetailPanel')?.classList.contains('open')) openAppDetail(selectedAppId);
      } else {
        renderEngagements();
        if (selectedEngagementId !== null && document.getElementById('engagementDetailPanel')?.classList.contains('open')) openEngagementDetail(selectedEngagementId);
      }
      if (cloudLocalRevision === revisionAtStart) {
        localStorage.removeItem('andre_crm_local_dirty');
        setStatus('synced', 'Cloud synced');
      } else {
        setStatus('syncing', 'Saving...');
      }
    } catch (err) {
      console.error(err);
      localStorage.setItem('andre_crm_local_dirty', '1');
      setStatus('error', 'Retry needed');
    } finally {
      cloudSaveInFlight = false;
      if (cloudLocalRevision !== revisionAtStart && !cloudSyncTimer) queueCloudRetry();
    }
  }

  async function initialize() {
    try {
      const session = await fetch('/api/crm/session', { cache: 'no-store' });
      if (session.status === 401) {
        showLogin();
        return;
      }
      await pullState(true);
    } catch (err) {
      console.warn('Cloud sync unavailable:', err);
      setStatus('error', 'Cloud offline');
    }
  }

  initialize();
})();
