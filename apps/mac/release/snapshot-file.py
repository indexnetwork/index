#!/usr/bin/env python3
"""Copy one stable regular non-link file into an exclusive same-directory snapshot."""
import hashlib
import os
import stat
import sys

if len(sys.argv) != 3:
    raise SystemExit("usage: snapshot-file.py SOURCE DESTINATION")
source, destination = sys.argv[1:]
flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
source_fd = destination_fd = None
try:
    source_fd = os.open(source, flags)
    before = os.fstat(source_fd)
    if not stat.S_ISREG(before.st_mode):
        raise RuntimeError("source is not a regular file")
    destination_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    digest = hashlib.sha256()
    size = 0
    while True:
        chunk = os.read(source_fd, 1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
        size += len(chunk)
        view = memoryview(chunk)
        while view:
            written = os.write(destination_fd, view)
            view = view[written:]
    after = os.fstat(source_fd)
    path = os.lstat(source)
    if (before.st_dev, before.st_ino, before.st_size) != (after.st_dev, after.st_ino, after.st_size):
        raise RuntimeError("source changed during snapshot")
    if (before.st_dev, before.st_ino) != (path.st_dev, path.st_ino) or stat.S_ISLNK(path.st_mode) or size != before.st_size:
        raise RuntimeError("source path changed during snapshot")
    os.fsync(destination_fd)
    print(digest.hexdigest())
except Exception:
    if destination_fd is not None:
        os.close(destination_fd)
        destination_fd = None
    try:
        os.unlink(destination)
    except FileNotFoundError:
        pass
    raise SystemExit("snapshot refused")
finally:
    if source_fd is not None:
        os.close(source_fd)
    if destination_fd is not None:
        os.close(destination_fd)
