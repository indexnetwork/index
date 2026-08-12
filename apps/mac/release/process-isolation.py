#!/usr/bin/env python3
import argparse,ctypes,hashlib,os,pathlib,subprocess
p=argparse.ArgumentParser();p.add_argument("--snapshot");p.add_argument("--root-pid",type=int,required=True);p.add_argument("--uid",type=int,required=True);p.add_argument("--allowlist",required=True);p.add_argument("--allowlist-sha256",required=True);p.add_argument("--listener-path",required=True);p.add_argument("--listener-sha256",required=True);p.add_argument("--worker-path",required=True);p.add_argument("--worker-sha256",required=True);a=p.parse_args()
def digest(path):
 with open(path,"rb") as f:return hashlib.sha256(f.read()).hexdigest()
def proc_pidpath(pid):
 lib=ctypes.CDLL("/usr/lib/libproc.dylib");buf=ctypes.create_string_buffer(4096)
 if lib.proc_pidpath(pid,buf,len(buf))<=0:raise SystemExit("proc_pidpath unavailable")
 return os.path.realpath(buf.value.decode())
allow=pathlib.Path(a.allowlist).read_bytes()
if hashlib.sha256(allow).hexdigest()!=a.allowlist_sha256:raise SystemExit("allowlist digest mismatch")
allowed=set(allow.decode().splitlines());rows={}
if a.snapshot:
 for line in pathlib.Path(a.snapshot).read_text().splitlines():
  pid,ppid,uid,path,*sha=line.split("\t");rows[int(pid)]=(int(ppid),int(uid),path,sha[0] if sha else "-")
else:
 for line in subprocess.check_output(["ps","-axo","pid=,ppid=,uid="],text=True).splitlines():
  pid,ppid,uid=map(int,line.split());path=proc_pidpath(pid);rows[pid]=(ppid,uid,path,digest(path))
ancestry=[];pid=a.root_pid
while pid in rows and pid not in ancestry:ancestry.append(pid);pid=rows[pid][0]
listeners=[x for x in ancestry if rows[x][2]==a.listener_path and rows[x][3]==a.listener_sha256];workers=[x for x in ancestry if rows[x][2]==a.worker_path and rows[x][3]==a.worker_sha256]
if len(listeners)!=1 or len(workers)!=1 or rows[workers[0]][0]!=listeners[0]:raise SystemExit("reviewed runner ancestry unavailable")
def descendant(pid,root):
 seen=set()
 while pid in rows and pid not in seen:
  if pid==root:return True
  seen.add(pid);pid=rows[pid][0]
 return False
for pid,(ppid,uid,path,sha) in rows.items():
 if uid!=a.uid or pid in ancestry or descendant(pid,a.root_pid) or path in allowed:continue
 raise SystemExit(f"unrelated same-UID process {pid}")
