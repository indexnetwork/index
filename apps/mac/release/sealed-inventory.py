#!/usr/bin/env python3
import hashlib, os, pathlib, stat, sys
mode,root_arg,seal_arg=sys.argv[1:];root=pathlib.Path(root_arg).resolve();seal=pathlib.Path(seal_arg)
def inventory():
 rows=[]
 for p in sorted([root,*root.rglob("*")],key=lambda x:str(x.relative_to(root))):
  s=p.lstat();rel="." if p==root else p.relative_to(root).as_posix();m=stat.S_IMODE(s.st_mode)
  if stat.S_ISDIR(s.st_mode): rows.append(f"{rel}\td\t{m:04o}\t0\t-")
  elif stat.S_ISREG(s.st_mode): rows.append(f"{rel}\tf\t{m:04o}\t{s.st_size}\t{hashlib.sha256(p.read_bytes()).hexdigest()}")
  else: raise SystemExit("sealed inventory rejects symlinks/devices")
 return "\n".join(rows)+"\n"
if mode=="create": seal.write_text(inventory());os.chmod(seal,0o600)
elif mode=="verify":
 if seal.is_symlink() or not seal.is_file() or seal.read_text()!=inventory():raise SystemExit("sealed inventory mismatch")
else:raise SystemExit("usage: create|verify ROOT SEAL")
