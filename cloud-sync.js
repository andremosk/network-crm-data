(function () {
  function payload(record) {
    const data = { ...(record || {}) };
    delete data._syncVersion;
    delete data._syncUpdatedAt;
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
    contacts.forEach((contact) => {
      cloudContactVersions.set(String(contact.id), Number(contact._syncVersion || 0));
      cloudContactFingerprints.set(String(contact.id), fingerprint(contact));
    });
    apps.forEach((app) => {
      cloudAppVersions.set(String(app.id), Number(app._syncVersion || 0));
      cloudAppFingerprints.set(String(app.id), fingerprint(app));
    });
  }

  async function pullState(initial = false) {
    if (cloudSyncTimer) return;
    setStatus('syncing', 'Loading cloud...');
    const response = await fetch('/api/crm/state', { cache: 'no-store' });
    if (response.status === 401) {
      cloudSyncReady = false;
      showLogin();
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || 'Could not load cloud CRM.');
    if (!Array.isArray(data.contacts) || data.contacts.length < 100) throw new Error('Cloud CRM is not initialized yet.');
    contacts = data.contacts.map(withFitDefaults);
    apps = Array.isArray(data.apps) ? data.apps.map((app) => ({ statusLog: [], ...app })) : apps;
    rememberState();
    cloudSyncReady = true;
    localStorage.setItem('andre_crm_v2', JSON.stringify(contacts));
    localStorage.setItem('andre_apps_v1', JSON.stringify(apps));
    localStorage.removeItem('andre_crm_local_dirty');
    if (currentView === 'contacts') renderList(); else renderApps();
    setStatus('synced', 'Cloud synced');
    if (initial && !cloudPollTimer) {
      cloudPollTimer = setInterval(() => {
        if (!document.hidden && cloudSyncReady && !cloudSyncTimer) {
          pullState().catch(() => setStatus('error', 'Cloud offline'));
        }
      }, 30000);
    }
  }

  function changedRecords(records, versions, fingerprints) {
    return records
      .filter((record) => fingerprint(record) !== fingerprints.get(String(record.id)))
      .map((record) => ({ id: record.id, version: versions.get(String(record.id)) || 0, data: payload(record) }));
  }

  function deletedRecords(records, versions) {
    const currentIds = new Set(records.map((record) => String(record.id)));
    return [...versions.entries()]
      .filter(([id]) => !currentIds.has(id))
      .map(([id, version]) => ({ id, version }));
  }

  function applyResults(records, versions, fingerprints, results) {
    for (const result of results || []) {
      const id = String(result.id);
      const index = records.findIndex((record) => String(record.id) === id);
      if (result.status === 'conflict' && result.data) {
        if (index >= 0) records[index] = { ...result.data, _syncVersion: result.version, _syncUpdatedAt: result.updatedAt };
        toast('A newer cloud edit was kept. Please review this record.');
      } else if (index >= 0 && result.version) {
        records[index]._syncVersion = result.version;
        records[index]._syncUpdatedAt = result.updatedAt;
      }
      if (index >= 0) {
        versions.set(id, Number(records[index]._syncVersion || result.version || 0));
        fingerprints.set(id, fingerprint(records[index]));
      }
    }
  }

  window.queueCloudSync = function queueCloudSync() {
    if (!cloudSyncReady) return;
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    setStatus('syncing', 'Saving...');
    cloudSyncTimer = setTimeout(flushState, 900);
  };

  async function flushState() {
    cloudSyncTimer = null;
    const requestBody = {
      contacts: changedRecords(contacts, cloudContactVersions, cloudContactFingerprints),
      apps: changedRecords(apps, cloudAppVersions, cloudAppFingerprints),
      deletedContacts: deletedRecords(contacts, cloudContactVersions),
      deletedApps: deletedRecords(apps, cloudAppVersions)
    };
    if (!requestBody.contacts.length && !requestBody.apps.length && !requestBody.deletedContacts.length && !requestBody.deletedApps.length) {
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
      applyResults(contacts, cloudContactVersions, cloudContactFingerprints, data.contacts);
      applyResults(apps, cloudAppVersions, cloudAppFingerprints, data.apps);
      const deletions = [...(data.deletedContacts || []), ...(data.deletedApps || [])];
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
      localStorage.setItem('andre_crm_v2', JSON.stringify(contacts));
      localStorage.setItem('andre_apps_v1', JSON.stringify(apps));
      localStorage.removeItem('andre_crm_local_dirty');
      setStatus('synced', 'Cloud synced');
    } catch (err) {
      console.error(err);
      localStorage.setItem('andre_crm_local_dirty', '1');
      setStatus('error', 'Retry needed');
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
