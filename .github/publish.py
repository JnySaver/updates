#!/usr/bin/env python3
"""
Runs in GitHub Actions on a push to the `incoming` branch (see workflows/publish.yml).

incoming/release.json:
  {"releases": [{"tag": "windows-1.5.0", "title": "JnySaver 1.5 for Windows", "notes": "...",
                 "files": ["JnySaver-Setup-1.5.0.exe"]}, ...]}
incoming/<files>         the installers
latest.json, latest.json.sig, instagram/*.js   what goes onto main

Before anything is published, every installer's SHA-256 is checked against latest.json, and each link in
latest.json must point at the release file being uploaded.
"""
import hashlib, json, os, subprocess, sys

REPO = os.environ["GITHUB_REPOSITORY"]


def sh(*a, check=True):
    print("+", " ".join(a), flush=True)
    return subprocess.run(a, check=check, text=True, capture_output=True)


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


rel = json.load(open("incoming/release.json"))
latest = json.load(open("latest.json"))
links = {}
for app in ("windows", "android"):
    if app in latest:
        links[latest[app]["url"]] = latest[app]

problems = []
for r in rel["releases"]:
    for f in r["files"]:
        path = os.path.join("incoming", f)
        url = f"https://github.com/{REPO}/releases/download/{r['tag']}/{f}"
        entry = links.get(url)
        if not os.path.exists(path):
            problems.append(f"missing {path}")
        elif entry is None:
            problems.append(f"latest.json doesn't link to {url}")
        elif entry["sha256"] != sha(path):
            problems.append(f"{f}: SHA-256 doesn't match latest.json")
if problems:
    print("Not publishing:\n  " + "\n  ".join(problems))
    sys.exit(1)

for r in rel["releases"]:
    files = [os.path.join("incoming", f) for f in r["files"]]
    exists = sh("gh", "release", "view", r["tag"], "--repo", REPO, check=False).returncode == 0
    if exists:
        sh("gh", "release", "upload", r["tag"], *files, "--clobber", "--repo", REPO)
    else:
        sh("gh", "release", "create", r["tag"], *files, "--title", r["title"], "--notes", r.get("notes", ""),
           "--repo", REPO, "--latest=" + ("true" if r.get("latest", True) else "false"))
    print("published", r["tag"])
