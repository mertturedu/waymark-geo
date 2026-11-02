#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PY=/opt/homebrew/bin/python3.13
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q -r requirements.txt

mkdir -p bin
.venv/bin/python - <<'PYEOF'
import hashlib, json, os, subprocess, tarfile, urllib.request, zipfile

lock_path = "tools.lock.json"
lock = json.load(open(lock_path))

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def fetch(name, tool, archive_name):
    archive = os.path.join("bin", archive_name)
    if not os.path.exists(archive):
        urllib.request.urlretrieve(tool["url"], archive)
    actual = sha256(archive)
    if tool["sha256"] == "":
        tool["sha256"] = actual
        json.dump(lock, open(lock_path, "w"), indent=2)
        open(lock_path, "a").write("\n")
    elif tool["sha256"] != actual:
        os.remove(archive)
        raise SystemExit(f"{name} archive sha256 does not match tools.lock.json")
    return archive

archive = fetch("pmtiles", lock["pmtiles"], "pmtiles.zip")
if not os.path.exists("bin/pmtiles"):
    with zipfile.ZipFile(archive) as z:
        z.extract("pmtiles", "bin")
    os.chmod("bin/pmtiles", 0o755)
print(subprocess.run(["bin/pmtiles", "version"], capture_output=True, text=True).stdout.strip())

os.makedirs("bin/hermes", exist_ok=True)
archive = fetch("hermes", lock["hermes"], "hermes/hermes-cli-darwin.tar.gz")
if not os.path.exists("bin/hermes/hermes"):
    with tarfile.open(archive) as t:
        t.extractall("bin/hermes", filter="data")
print(subprocess.run(["bin/hermes/hermes", "--version"], capture_output=True, text=True).stdout.splitlines()[0])
PYEOF
