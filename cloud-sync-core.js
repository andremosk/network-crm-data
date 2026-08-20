(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CloudSyncCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function createTemporaryId(records, now) {
    const used = new Set((records || []).map((record) => String(record.id)));
    let candidate = -Math.max(1, Math.abs(Math.trunc(Number(now) || Date.now())));
    while (used.has(String(candidate))) candidate -= 1;
    return candidate;
  }

  function shouldApplyPull(revisionAtStart, currentRevision, hasPendingSave, saveInFlight) {
    return revisionAtStart === currentRevision && !hasPendingSave && !saveInFlight;
  }

  function changedRecords(records, versions, fingerprints, payload, fingerprint) {
    return records
      .filter((record) => fingerprint(record) !== fingerprints.get(String(record.id)))
      .map((record) => {
        const id = String(record.id);
        const version = versions.get(id) || 0;
        return {
          id: record.id,
          version,
          create: !!record._syncPendingCreate || !versions.has(id),
          data: payload(record)
        };
      });
  }

  function resultId(result) {
    const value = result && result.data ? result.data.id : result.id;
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value;
  }

  function applyResults(records, versions, fingerprints, results, sentRecords, fingerprint) {
    const sentById = new Map((sentRecords || []).map((record) => [String(record.id), record]));
    const remaps = [];
    const conflicts = [];

    for (const result of results || []) {
      const requestedId = String(result.requestedId ?? result.id);
      const assignedId = String(result.id);
      const index = records.findIndex((record) => String(record.id) === requestedId);
      if (index < 0) continue;

      if (result.status === 'conflict' && result.data) {
        records[index] = { ...result.data, _syncVersion: result.version, _syncUpdatedAt: result.updatedAt };
        conflicts.push(requestedId);
      } else {
        if (assignedId !== requestedId) {
          records[index].id = resultId(result);
          delete records[index]._syncPendingCreate;
          versions.delete(requestedId);
          fingerprints.delete(requestedId);
          remaps.push({ requestedId, assignedId: String(records[index].id) });
        }
        if (result.version) {
          records[index]._syncVersion = result.version;
          records[index]._syncUpdatedAt = result.updatedAt;
        }
      }

      const finalId = String(records[index].id);
      versions.set(finalId, Number(records[index]._syncVersion || result.version || 0));
      const sent = sentById.get(requestedId);
      fingerprints.set(finalId, fingerprint(result.data || sent?.data || records[index]));
    }
    return { remaps, conflicts };
  }

  return { applyResults, changedRecords, createTemporaryId, shouldApplyPull };
});
