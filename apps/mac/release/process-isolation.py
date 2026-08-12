#!/usr/bin/env python3
import argparse, ctypes, ctypes.util, errno, hashlib, os, pathlib, struct

parser = argparse.ArgumentParser()
parser.add_argument("--snapshot")
parser.add_argument("--root-pid", type=int, required=True)
parser.add_argument("--scanner-pid", type=int, default=os.getpid())
parser.add_argument("--uid", type=int, required=True)
parser.add_argument("--allowlist", required=True)
parser.add_argument("--allowlist-sha256", required=True)
parser.add_argument("--listener-path", required=True)
parser.add_argument("--listener-sha256", required=True)
parser.add_argument("--worker-path", required=True)
parser.add_argument("--worker-sha256", required=True)
args = parser.parse_args()

class Row:
    def __init__(self, pid, ppid, uid, identity, path, digest, rechecked_ppid, rechecked_uid, rechecked_identity):
        self.pid, self.ppid, self.uid = pid, ppid, uid
        self.identity, self.path, self.digest = identity, path, digest
        self.rechecked_ppid, self.rechecked_uid, self.rechecked_identity = rechecked_ppid, rechecked_uid, rechecked_identity

def file_digest(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(descriptor)
        digest = hashlib.sha256()
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk: break
            digest.update(chunk)
        after = os.fstat(descriptor)
        if (before.st_dev, before.st_ino, before.st_size) != (after.st_dev, after.st_ino, after.st_size):
            raise SystemExit("executable changed while hashing")
        return digest.hexdigest()
    finally:
        os.close(descriptor)

def load_snapshot(path):
    rows = {}
    for line in pathlib.Path(path).read_text().splitlines():
        fields = line.split("\t")
        if len(fields) == 4:
            pid, ppid, uid = map(int, fields[:3]); path_value = fields[3]
            fields = [str(pid), str(ppid), str(uid), f"{pid}:fixture", path_value, "-", str(ppid), str(uid), f"{pid}:fixture"]
        elif len(fields) == 7:
            pid, ppid, uid = map(int, fields[:3])
            fields = [*fields[:6], str(ppid), str(uid), fields[6]]
        if len(fields) != 9: raise SystemExit("malformed process snapshot")
        pid, ppid, uid, rechecked_ppid, rechecked_uid = map(int, [*fields[:3], *fields[6:8]])
        if pid in rows: raise SystemExit("duplicate process snapshot PID")
        rows[pid] = Row(pid, ppid, uid, *fields[3:6], rechecked_ppid, rechecked_uid, fields[8])
    return rows

def live_identity(libproc, pid):
    # proc_bsdinfo starts with flags/status/xstatus/pid/ppid/uid/gid... and
    # exposes pbi_start_tvsec/usec near the end. The complete 136-byte buffer
    # is read so PID identity is stable across path/hash operations.
    PROC_PIDTBSDINFO = 3
    buffer = ctypes.create_string_buffer(136)
    size = libproc.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, buffer, len(buffer))
    if size != len(buffer):
        error = ctypes.get_errno()
        if error in (errno.ESRCH, errno.ENOENT): return None
        raise SystemExit(f"proc_pidinfo failed for persistent PID {pid}")
    data = buffer.raw
    ppid = struct.unpack_from("I", data, 16)[0]
    uid = struct.unpack_from("I", data, 20)[0]
    start_sec = struct.unpack_from("Q", data, 120)[0]
    start_usec = struct.unpack_from("Q", data, 128)[0]
    return ppid, uid, f"{start_sec}:{start_usec}"

def live_rows(root_pid, scanner_pid):
    libproc = ctypes.CDLL(ctypes.util.find_library("proc") or "/usr/lib/libproc.dylib", use_errno=True)
    libproc.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
    count = libproc.proc_listallpids(None, 0)
    if count <= 0: raise SystemExit("proc_listallpids unavailable")
    values = (ctypes.c_int * (count * 2))()
    returned = libproc.proc_listallpids(values, ctypes.sizeof(values))
    if returned <= 0: raise SystemExit("proc_listallpids snapshot unavailable")
    pids = sorted(set(values[:returned]))
    identities = {}
    for pid in pids:
        initial = live_identity(libproc, pid)
        if initial is not None: identities[pid] = initial
    def classified_descendant(pid):
        seen = set()
        while pid in identities and pid not in seen:
            if pid in (root_pid, scanner_pid): return True
            seen.add(pid); pid = identities[pid][0]
        return False
    rows = {}
    for pid, (ppid, uid, identity) in identities.items():
        # Classify the current guard/scanner and all descendants from the first
        # libproc identity pass, before attempting path resolution.
        classified = classified_descendant(pid)
        if classified:
            path, digest = ("<classified>", "-")
        else:
            buffer = ctypes.create_string_buffer(4096)
            if libproc.proc_pidpath(pid, buffer, len(buffer)) <= 0:
                if live_identity(libproc, pid) is None: continue
                raise SystemExit(f"proc_pidpath failed for persistent PID {pid}")
            path = os.path.realpath(buffer.value.decode())
            try: digest = file_digest(path)
            except FileNotFoundError:
                if live_identity(libproc, pid) is None: continue
                raise SystemExit(f"executable vanished for persistent PID {pid}")
        rechecked = live_identity(libproc, pid)
        if rechecked is None:
            if classified: rows[pid] = Row(pid, ppid, uid, identity, "<vanished>", "-", ppid, uid, "-")
            continue
        if rechecked != (ppid, uid, identity): raise SystemExit(f"PID identity changed during scan: {pid}")
        rows[pid] = Row(pid, ppid, uid, identity, path, digest, *rechecked)
    return rows

allow_bytes = pathlib.Path(args.allowlist).read_bytes()
if hashlib.sha256(allow_bytes).hexdigest() != args.allowlist_sha256:
    raise SystemExit("allowlist digest mismatch")
allowed = {line for line in allow_bytes.decode().splitlines() if line}
rows = load_snapshot(args.snapshot) if args.snapshot else live_rows(args.root_pid, args.scanner_pid)
if args.root_pid not in rows: raise SystemExit("guard root missing from process snapshot")

def descendant(pid, root):
    seen = set()
    while pid in rows and pid not in seen:
        if pid == root: return True
        seen.add(pid); pid = rows[pid].ppid
    return False

ancestry = []
pid = args.root_pid
while pid in rows and pid not in ancestry:
    ancestry.append(pid); pid = rows[pid].ppid
listeners = [pid for pid in ancestry if rows[pid].path == args.listener_path and rows[pid].digest == args.listener_sha256]
workers = [pid for pid in ancestry if rows[pid].path == args.worker_path and rows[pid].digest == args.worker_sha256]
if len(listeners) != 1 or len(workers) != 1 or rows[workers[0]].ppid != listeners[0]:
    raise SystemExit("reviewed runner ancestry unavailable")
for pid, row in rows.items():
    identity_unchanged = (row.ppid, row.uid, row.identity) == (row.rechecked_ppid, row.rechecked_uid, row.rechecked_identity)
    if not identity_unchanged and not (pid == args.scanner_pid and row.rechecked_identity == "-" and row.ppid == row.rechecked_ppid and row.uid == row.rechecked_uid):
        raise SystemExit(f"PID identity changed during scan: {pid}")
    if row.uid != args.uid or pid in ancestry or descendant(pid, args.root_pid): continue
    if row.path in allowed: continue
    raise SystemExit(f"unrelated same-UID process {pid}")
