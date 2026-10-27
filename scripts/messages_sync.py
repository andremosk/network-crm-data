#!/usr/bin/python3
"""Read recent Apple Messages exports and submit private CRM summary drafts."""

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.request


APP_DIR = Path.home() / "Library" / "Application Support" / "Network CRM"
DEFAULT_CONFIG = APP_DIR / "messages-sync.json"
DEFAULT_STATE = APP_DIR / "messages-sync-state.json"
DEFAULT_UNMATCHED = APP_DIR / "messages-sync-unmatched.json"
DEFAULT_RECEIPTS = APP_DIR / "messages-sync-receipts.json"
DEFAULT_EXPORTER = APP_DIR / "bin" / "imessage-exporter"
SELF_NAME = "Andre"
TIMESTAMP = re.compile(
    r"(?m)^(?P<stamp>[A-Z][a-z]{2} \d{1,2}, \d{4}  \d{1,2}:\d{2}:\d{2} [AP]M)(?: \([^\n]*\))?\n"
)

BUSINESS_CONTEXT = re.compile(
    r"\b(clients?|customers?|projects?|proposals?|invoices?|contracts?|referrals?|"
    r"business|workflow|automation|automate|dashboard|prototype|consulting|"
    r"receivables|payables|profitability|implementation|deliverables?|scope|"
    r"vendor|integration|connector|power bi|business central|bc cloud|"
    r"ap/ar|ar/ap|nda|curriculum|website|webflow|software|sales|hiring|"
    r"career|job offer|introductions?|introduce[ds]?|introducing|intro|"
    r"connect (?:us|you|them|her|him)|change management|school districts?|ai)\b", re.IGNORECASE
)


def has_business_context(messages):
    """Gate unfamiliar senders locally; only inspect message bodies, not names/URLs."""
    for message in messages:
        body = str(message.get("body") or "").strip()
        if re.match(r'^(Liked|Loved|Laughed at|Emphasized|Disliked|Questioned)\s+[“"]', body):
            continue
        body = re.sub(r"https?://\S+", "", body)
        if len(re.findall(r"\b\w+\b", body)) >= 3 and BUSINESS_CONTEXT.search(body):
            return True
    return False


def normalize_name(value):
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).split())


def normalize_email(value):
    return str(value or "").strip().lower()


def normalize_phone(value):
    value = str(value or "").strip()
    digits = re.sub(r"\D", "", value)
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return "+" + digits if value.startswith("+") and digits else digits


def parse_export(text):
    matches = list(TIMESTAMP.finditer(text))
    messages = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.end():end].strip()
        if not block or "\n" not in block:
            continue
        sender, body = block.split("\n", 1)
        body = body.strip()
        if not body:
            continue
        try:
            timestamp = dt.datetime.strptime(match.group("stamp"), "%b %d, %Y  %I:%M:%S %p")
            timestamp = timestamp.astimezone()
        except ValueError:
            continue
        messages.append({"at": timestamp, "sender": sender.strip(), "body": body})
    return messages


def build_indexes(contacts):
    indexes = {"name": {}, "email": {}, "phone": {}}
    for contact in contacts:
        for field, normalizer in (
            ("name", normalize_name),
            ("email", normalize_email),
            ("phone", normalize_phone),
        ):
            raw_value = contact.get(field)
            if field == "name" and not raw_value:
                raw_value = contact.get("normalizedName")
            value = normalizer(raw_value)
            if value:
                indexes[field].setdefault(value, []).append(contact)
        aliases = contact.get("smsAliases", [])
        if isinstance(aliases, list):
            for alias in {normalize_name(alias) for alias in aliases if isinstance(alias, str)}:
                if alias and alias != normalize_name(contact.get("name") or contact.get("normalizedName")):
                    indexes["name"].setdefault(alias, []).append(contact)
    return indexes


def match_contact(labels, indexes):
    matches = {}
    for label in labels:
        candidates = [label]
        candidates.extend(re.findall(r"[\w.+-]+@[\w.-]+", label))
        candidates.extend(re.findall(r"\+?\d[\d() .-]{8,}\d", label))
        for candidate in candidates:
            for field, normalizer in (
                ("email", normalize_email),
                ("phone", normalize_phone),
                ("name", normalize_name),
            ):
                value = normalizer(candidate)
                found = indexes[field].get(value, [])
                if len(found) > 1:
                    return None
                if len(found) == 1:
                    matches[str(found[0]["id"])] = found[0]
    if len(matches) == 1:
        return next(iter(matches.values()))
    if len(matches) > 1:
        return None

    # Contact cards often include a maiden or married name that the Mac card omits.
    # Accept a token-subset match only when it identifies exactly one CRM contact.
    subset_matches = {}
    all_contacts = {str(item["id"]): item for values in indexes["name"].values() for item in values}
    for label in labels:
        label_tokens = set(normalize_name(label).split())
        if len(label_tokens) < 2:
            continue
        for contact in all_contacts.values():
            contact_tokens = set(normalize_name(contact.get("name") or contact.get("normalizedName")).split())
            if len(contact_tokens) >= 2 and (label_tokens <= contact_tokens or contact_tokens <= label_tokens):
                subset_matches[str(contact["id"])] = contact
    return next(iter(subset_matches.values())) if len(subset_matches) == 1 else None


def is_likely_group(stem, other_senders, indexes):
    if len(other_senders) > 1 or " and " in stem.lower() and " others" in stem.lower():
        return True
    exact_name = indexes["name"].get(normalize_name(stem), [])
    return ", " in stem and len(exact_name) != 1


def api_request(base_url, token, path, method="GET", payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "User-Agent": "NetworkCRM-MessagesSync/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError("CRM API returned {}: {}".format(error.code, detail[:500])) from error


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def isoformat(value):
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def conversation_key(value):
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def message_key(message):
    return conversation_key(isoformat(message["at"]) + "\n" + message["sender"] + "\n" + message["body"])


def select_unseen(messages, since, receipt):
    # Bootstrap without replaying old reviewed conversations. Subsequent runs
    # scan the overlap by message fingerprint, including late Mac arrivals.
    if receipt is None:
        return [item for item in messages if item["at"] > since]
    seen = set(receipt.get("seen", []))
    return [item for item in messages if message_key(item) not in seen]


def main():
    parser = argparse.ArgumentParser(description="Create Network.crm text-summary drafts.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--unmatched-report", type=Path, default=DEFAULT_UNMATCHED)
    parser.add_argument("--receipts", type=Path, default=DEFAULT_RECEIPTS)
    parser.add_argument("--lookback-hours", type=int, default=12)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    config = read_json(args.config, {})
    base_url = os.environ.get("NETWORK_CRM_URL") or config.get("url") or "https://network-crm-data.vercel.app"
    token = os.environ.get("NETWORK_CRM_AUTOMATION_TOKEN") or config.get("token")
    exporter = Path(os.environ.get("IMESSAGE_EXPORTER") or config.get("exporter") or DEFAULT_EXPORTER)
    if not token:
        raise SystemExit("Missing CRM access token. Run scripts/setup_messages_sync.sh first.")
    if not exporter.is_file():
        raise SystemExit("iMessage exporter is not installed. Run scripts/setup_messages_sync.sh first.")

    now = dt.datetime.now().astimezone()
    state = read_json(args.state, {})
    since_text = state.get("lastCompletedAt")
    try:
        since = dt.datetime.fromisoformat(since_text.replace("Z", "+00:00")) if since_text else None
    except (ValueError, AttributeError):
        since = None
    if since is None:
        since = now - dt.timedelta(hours=max(1, args.lookback_hours))

    receipts = read_json(args.receipts)
    receipt_baseline_exists = receipts is not None
    receipts = receipts or {"conversations": {}}
    conversation_receipts = receipts.setdefault("conversations", {})
    scan_since = min(since, now - dt.timedelta(hours=72))

    def record_outcome(key, all_messages, outcome, contact=None):
        if args.dry_run:
            return
        conversation_receipts[key] = {
            "seen": [message_key(item) for item in all_messages],
            "outcome": outcome,
            "contactId": str(contact["id"]) if contact else None,
            "checkedAt": isoformat(now),
            "latestMessageAt": isoformat(all_messages[-1]["at"]),
        }
        write_private_json(args.receipts, receipts)
        print("Messages outcome: conversation={} contact={} outcome={} at={}".format(
            key[:16], str(contact["id"]) if contact else "unmatched", outcome, isoformat(now)))

    directory = api_request(base_url, token, "/api/automation/text-summaries")
    contacts = directory.get("contacts", [])
    indexes = build_indexes(contacts)
    contacts_by_id = {str(contact["id"]): contact for contact in contacts}
    decisions = {item.get("key"): item for item in directory.get("conversationDecisions", []) if item.get("key")}
    existing_unmatched = read_json(args.unmatched_report, {}).get("unmatched", [])
    stats = {"files": 0, "matched": 0, "unmatched": 0, "ignored": 0, "group": 0, "submitted": 0, "skipped": 0, "filtered": 0}
    unmatched = []
    unmatched_observations = []

    with tempfile.TemporaryDirectory(prefix="network-crm-messages-") as folder:
        command = [
            str(exporter), "--format", "txt", "--copy-method", "disabled",
            "--export-path", folder, "--start-date", scan_since.astimezone().strftime("%Y-%m-%d"),
            "--custom-name", SELF_NAME, "--no-progress"
        ]
        result = subprocess.run(command, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise SystemExit("Could not read Messages. Check Full Disk Access. " + result.stderr[-800:])

        for path in Path(folder).rglob("*.txt"):
            stats["files"] += 1
            all_messages = [item for item in parse_export(path.read_text(encoding="utf-8", errors="replace")) if item["at"] > scan_since]
            if not all_messages:
                continue
            stem = re.sub(r" - \d+$", "", path.stem)
            key = conversation_key(stem)
            messages = select_unseen(all_messages, since, conversation_receipts.get(key, {"seen": []} if receipt_baseline_exists else None))
            if not messages:
                if key not in conversation_receipts:
                    record_outcome(key, all_messages, "baseline")
                continue
            other_senders = sorted({item["sender"] for item in all_messages if normalize_name(item["sender"]) != normalize_name(SELF_NAME)})
            labels = other_senders or [stem]
            if is_likely_group(stem, other_senders, indexes):
                stats["group"] += 1
                record_outcome(key, all_messages, "group")
                continue
            decision = decisions.get(key, {})
            if decision.get("status") == "ignored":
                stats["ignored"] += 1
                record_outcome(key, all_messages, "ignored")
                continue
            observation = {
                "key": key,
                "label": labels[0] if labels else stem,
                "latestMessageAt": isoformat(messages[-1]["at"]),
            }
            contact = contacts_by_id.get(str(decision.get("contactId"))) if decision.get("status") == "matched" else None
            if contact is None:
                contact = match_contact(labels + [stem], indexes)
            if not contact:
                if not has_business_context(messages):
                    stats["filtered"] += 1
                    record_outcome(key, all_messages, "unfamiliar_no_business_signal")
                    continue
                if decision.get("status") == "dismissed":
                    unmatched_observations.append(observation)
                    continue
                stats["unmatched"] += 1
                unmatched_observations.append(observation)
                unmatched.append({
                    "key": key,
                    "participant": labels[0] if labels else stem,
                    "conversation": stem,
                    "latestMessageAt": isoformat(messages[-1]["at"]),
                })
                continue
            stats["matched"] += 1
            transcript = "\n\n".join(
                "{}\n{}: {}".format(item["at"].isoformat(), item["sender"], item["body"])
                for item in messages
            )[-24000:]
            fingerprint = hashlib.sha256((str(contact["id"]) + "\n" + transcript).encode("utf-8")).hexdigest()
            if args.dry_run:
                continue
            response = api_request(base_url, token, "/api/automation/text-summaries", "POST", {
                "contactId": contact["id"],
                "sourceKey": fingerprint,
                "startedAt": isoformat(messages[0]["at"]),
                "endedAt": isoformat(messages[-1]["at"]),
                "messageCount": len(messages),
                "transcript": transcript,
            })
            outcome = response.get("status")
            if outcome not in ("pending", "duplicate", "skipped"):
                raise RuntimeError("Unexpected SMS import outcome; checkpoint not advanced.")
            record_outcome(key, all_messages, outcome, contact)
            if response.get("status") == "pending":
                stats["submitted"] += 1
            else:
                stats["skipped"] += 1

    if unmatched_observations and not args.dry_run:
        api_request(base_url, token, "/api/automation/text-summaries", "POST", {
            "type": "unmatched",
            "conversations": unmatched_observations,
        })

    unmatched_by_conversation = {
        item.get("conversation") or item.get("participant"): item
        for item in existing_unmatched
        if item.get("participant") and not match_contact(
            [item.get("participant", ""), item.get("conversation", "")], indexes
        )
    }
    unmatched_by_conversation.update({
        item.get("conversation") or item.get("participant"): item for item in unmatched
    })
    cutoff = now.astimezone(dt.timezone.utc) - dt.timedelta(days=30)
    retained_unmatched = []
    for item in unmatched_by_conversation.values():
        try:
            latest = dt.datetime.fromisoformat(item["latestMessageAt"].replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            continue
        if latest >= cutoff:
            retained_unmatched.append(item)
    write_private_json(args.unmatched_report, {
        "generatedAt": isoformat(now),
        "unmatched": sorted(retained_unmatched, key=lambda item: item["latestMessageAt"], reverse=True),
    })
    if not args.dry_run:
        receipts["conversations"] = {key: value for key, value in conversation_receipts.items()
            if value.get("checkedAt", "") >= isoformat(now - dt.timedelta(days=7))}
        write_private_json(args.receipts, receipts)
        write_private_json(args.state, {"lastCompletedAt": isoformat(now)})
    print("Messages sync: {matched} matched, {submitted} awaiting review, {skipped} skipped, {unmatched} unmatched, {filtered} unfamiliar personal threads filtered locally, {ignored} ignored, {group} group threads excluded.".format(**stats))


if __name__ == "__main__":
    main()
