#!/usr/bin/python3 -I
"""Proposed root-installed two-release transition router. No install side effects.

Copy as helper-transition.py and start-transition. Both exact version contracts
remain unchanged in separate root-controlled slots. This router never grants
release approval or performs restore, migration, link switch or service restart.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

CONFIG = "/etc/nuaafa/security-transition.json"
OLD = "b68797c2e28e9dfdec215c460243628d1f0a4f6a"
NEW = "6db56b94c25ca3ce1376dabbda74714448decf53"
ALLOWED = {
    OLD: "7ab7b87387363fb91ba9787eabd64f80c9ba76f1ded9b6fcf6915fb3f0de70b0",
    NEW: "20aa86143e1e65553fa37d27e3e67258f4e55136ccc4adc7d8bcb317a34f5ba1",
}

def require(value, message):
    if not value: raise ValueError(message)

def trusted(path):
    p = Path(path)
    require(p.is_absolute() and p.resolve(strict=True) == p, "noncanonical transition path")
    for item in (p, *p.parents):
        s = item.lstat()
        require(s.st_uid == 0 and not s.st_mode & 0o022 and not stat.S_ISLNK(s.st_mode), "untrusted transition metadata")
    s = p.stat()
    require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, "transition file type or alias")
    return p

def option(args, key):
    found = []
    for i, arg in enumerate(args):
        if arg == key:
            require(i + 1 < len(args), "missing transition argument")
            found.append(args[i + 1])
        elif arg.startswith(key + "="): found.append(arg[len(key) + 1:])
    require(len(found) == 1, "duplicate or missing transition argument")
    return found[0]

def main():
    args = sys.argv[1:]
    startup = Path(sys.argv[0]).name == "start-transition"
    cfg = json.loads(trusted(CONFIG).read_bytes())
    require(set(cfg) == {"format", "current", "releases", "contracts"} and cfg["format"] == 1, "transition configuration shape")
    require(set(cfg["contracts"]) == set(ALLOWED), "transition is restricted to two reviewed commits")
    commit = NEW
    if startup:
        if args == ["--contract-version"]:
            print("NUAAFA_STARTUP_CONTRACT=V2.10X-PREBUILT-3")
            return
        require(not args or (len(args) == 2 and args[0] == "--check-release"), "invalid transition startup arguments")
        current = Path(cfg["current"])
        target = Path(args[1]) if args else Path(os.readlink(current))
        require(target.parent == Path(cfg["releases"]) and target.name in ALLOWED, "unapproved transition startup target")
        commit = target.name
    else:
        require(args and args[0] != "--timings", "explicit non-timing helper command required")
        if args[0] == "verify":
            commit = option(args, "--commit")
            require(commit in ALLOWED and option(args, "--sha256") == ALLOWED[commit], "unapproved transition artifact")
        elif args[0] == "platform":
            receipt = json.loads(trusted(option(args, "--receipt")).read_bytes())
            commit = receipt["commit"]
            require(commit in ALLOWED and receipt["sha256"] == ALLOWED[commit], "unapproved transition platform receipt")
    contract = cfg["contracts"][commit]
    require(set(contract) == {"sha256", "node", "node_sha256", "helper", "helper_sha256", "start", "start_sha256"}, "transition slot shape")
    require(contract["sha256"] == ALLOWED[commit], "transition slot artifact differs")
    for name in ("node", "helper", "start"):
        p = trusted(contract[name])
        with p.open("rb") as f:
            h = hashlib.sha256()
            for chunk in iter(lambda: f.read(1024 * 1024), b""): h.update(chunk)
        require(h.hexdigest() == contract[name + "_sha256"], "transition tool digest differs")
    env = {"PATH": str(Path(contract["node"]).parent) + ":/usr/bin:/bin"}
    command = contract["start"] if startup else contract["helper"]
    os.execve("/usr/bin/python3", ["python3", "-I", command, *args], env)

if __name__ == "__main__":
    try: main()
    except (ValueError, KeyError, OSError, TypeError) as error:
        print("STOP: " + str(error), file=sys.stderr)
        sys.exit(1)
