#!/usr/bin/python3
"""Run bounded Gmail review and daily incremental address enrichment."""

import datetime as dt
import fcntl
import os
from pathlib import Path

from messages_sync import APP_DIR, DEFAULT_CONFIG, api_request, read_json, write_private_json


def run_pages(request, path, payload, more_field, limit):
    totals = {"scanned": 0, "proposed": 0}
    more = False
    for _ in range(limit):
        result = request(path, payload)
        for key in totals:
            totals[key] += int(result.get(key) or 0)
        more = bool(result.get("has_more")) if more_field == "has_more" else not result.get("completed", True)
        if not more:
            break
    return totals, more


def sync(request, state, today):
    counts, more = run_pages(request, "/api/automation/gmail-review-sync", {}, "has_more", 4)
    print("Gmail review: {scanned} checked, {proposed} new proposals; backlog={}.".format(more, **counts))
    if state.get("lastEnrichmentDate") != today:
        counts, more = run_pages(request, "/api/automation/gmail-email-enrichment", {"mode": "recent"}, "completed", 3)
        print("Email enrichment: {scanned} checked, {proposed} new suggestions; backlog={}.".format(more, **counts))
        if not more:
            state["lastEnrichmentDate"] = today
    return state


def main():
    APP_DIR.mkdir(parents=True, exist_ok=True)
    lock_path = APP_DIR / "gmail-sync.lock"
    descriptor = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        config = read_json(DEFAULT_CONFIG, {})
        token = config.get("token")
        if not token:
            raise RuntimeError("Missing stored CRM key")
        url = config.get("url") or "https://network-crm-data.vercel.app"
        state_path = APP_DIR / "gmail-sync-state.json"
        state = read_json(state_path, {})
        def request(path, payload):
            return api_request(url, token, path, "POST", payload)
        result = sync(request, state, dt.datetime.now().astimezone().date().isoformat())
        write_private_json(state_path, result)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # HTTP error bodies may contain private data. Keep scheduled logs content-free.
        print("Gmail sync failed ({}); check Gmail connection and CRM service. Will retry next run.".format(type(error).__name__))
        raise SystemExit(1)
