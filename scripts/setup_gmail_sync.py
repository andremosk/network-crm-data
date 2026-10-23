#!/usr/bin/python3
"""Install a Gmail LaunchAgent using the existing private Messages configuration."""

import os
from pathlib import Path
import plistlib
import shutil
import subprocess


def main():
    app = Path.home() / "Library" / "Application Support" / "Network CRM"
    if not (app / "messages-sync.json").is_file():
        raise SystemExit("Set up Messages sync first so Gmail can reuse its stored CRM key.")
    source = Path(__file__).resolve().parent / "gmail_sync.py"
    destination = app / source.name
    shutil.copyfile(source, destination)
    os.chmod(destination, 0o700)
    label = "com.networkcrm.gmail-sync"
    plist = Path.home() / "Library" / "LaunchAgents" / (label + ".plist")
    plist.parent.mkdir(parents=True, exist_ok=True)
    config = {
        "Label": label,
        "ProgramArguments": ["/usr/bin/python3", str(destination)],
        "StartCalendarInterval": [{"Hour": 11, "Minute": 0}, {"Hour": 15, "Minute": 0}, {"Hour": 21, "Minute": 15}],
        "StandardOutPath": str(app / "gmail-sync.log"),
        "StandardErrorPath": str(app / "gmail-sync-error.log"),
        "Umask": 0o077,
    }
    with plist.open("wb") as handle:
        plistlib.dump(config, handle)
    os.chmod(plist, 0o600)
    domain = "gui/{}".format(os.getuid())
    subprocess.run(["launchctl", "bootout", domain + "/" + label], capture_output=True)
    subprocess.run(["launchctl", "bootstrap", domain, str(plist)], check=True)
    print("Gmail schedule installed: 11 AM, 3 PM, 9:15 PM local time; daily incremental enrichment.")


if __name__ == "__main__":
    main()
