#!/usr/bin/env python3
import argparse, hashlib, os, pathlib, subprocess, sys
p=argparse.ArgumentParser();p.add_argument("--snapshot");p.add_argument("--root-pid",type=int,required=True);p.add_argument("--uid",type=int,required=True);p.add_argument("--allowlist",required=True);p.add_argument("--allowlist-sha256",required=True);a=p.parse_args()
allow_bytes=pathlib.Path(a.allowlist).read_bytes()
if hashlib.sha256(allow_bytes).hexdigest()!=a.allowlist_sha256: raise SystemExit("process allowlist digest mismatch")
allowed_os={line for line in allow_bytes.decode().splitlines() if line}
rows={}
lines=pathlib.Path(a.snapshot).read_text().splitlines() if a.snapshot else subprocess.check_output(["ps","-axo","pid=,ppid=,uid=,comm="],text=True).splitlines()
for line in lines:
 parts=line.strip().split(None,3)
 if len(parts)==4: rows[int(parts[0])]=(int(parts[1]),int(parts[2]),parts[3])
if a.root_pid not in rows: raise SystemExit("guard root missing from process snapshot")
ancestry=[];pid=a.root_pid
while pid in rows and pid not in ancestry: ancestry.append(pid);pid=rows[pid][0]
listener=[pid for pid in ancestry if rows[pid][2]=="/opt/actions-runner/bin/Runner.Listener"]
worker=[pid for pid in ancestry if rows[pid][2]=="/opt/actions-runner/bin/Runner.Worker"]
if len(listener)!=1 or len(worker)!=1 or rows[worker[0]][0]!=listener[0]: raise SystemExit("exact GitHub runner ancestry unavailable")
def descendant(pid,root):
 seen=set()
 while pid in rows and pid not in seen:
  if pid==root:return True
  seen.add(pid);pid=rows[pid][0]
 return False
for pid,(ppid,uid,exe) in rows.items():
 if uid!=a.uid: continue
 if pid in ancestry or descendant(pid,a.root_pid): continue
 if exe in allowed_os: continue
 raise SystemExit(f"unrelated same-UID process: {pid} {exe}")
