#!/usr/bin/env python3
import hashlib, os, pathlib, stat, sys

if len(sys.argv) < 4:
    raise SystemExit("usage: create|verify|approved ROOT SEAL [APPROVED_RELATIVE_FILES...]")
mode, root_arg, seal_arg, *approved = sys.argv[1:]
root_input = pathlib.Path(root_arg)
root = pathlib.Path(os.path.realpath(root_input))
seal = pathlib.Path(seal_arg)

def root_identity():
    details = root.lstat()
    if root != root_input.absolute() or not stat.S_ISDIR(details.st_mode) or root.is_symlink():
        raise SystemExit("sealed root must be a canonical physical directory")
    return details

def inventory_rows():
    root_details = root_identity()
    rows = []
    paths = sorted([root, *root.rglob("*")], key=lambda path: str(path.relative_to(root)))
    for path in paths:
        details = path.lstat()
        relative = "." if path == root else path.relative_to(root).as_posix()
        permissions = stat.S_IMODE(details.st_mode)
        if stat.S_ISDIR(details.st_mode):
            rows.append((relative, "d", f"{permissions:04o}", "0", "-"))
        elif stat.S_ISREG(details.st_mode):
            try:
                digest = hashlib.new("sha256", usedforsecurity=False)
            except TypeError:
                digest = hashlib.new("sha256")
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            rows.append((relative, "f", f"{permissions:04o}", str(details.st_size), digest.hexdigest()))
        else:
            raise SystemExit("sealed inventory rejects symlinks/devices")
    header = ("seal-v1", str(root), str(root_details.st_dev), str(root_details.st_ino))
    return header, rows

def render():
    header, rows = inventory_rows()
    return "\t".join(header) + "\n" + "".join("\t".join(row) + "\n" for row in rows)

def verify():
    if seal.is_symlink() or not seal.is_file() or seal.read_text() != render():
        raise SystemExit("sealed inventory mismatch")

if mode == "create":
    if root == seal or root in seal.parents:
        raise SystemExit("seal authority must be outside the sealed root")
    if seal.exists() or seal.is_symlink():
        raise SystemExit("refusing to replace seal")
    seal.write_text(render())
    os.chmod(seal, 0o600)
elif mode == "verify":
    verify()
elif mode == "approved":
    verify()
    if not approved or len(set(approved)) != len(approved):
        raise SystemExit("approved inventory must be nonempty and unique")
    lines = seal.read_text().splitlines()[1:]
    parsed = {parts[0]: parts for parts in (line.split("\t") for line in lines)}
    inventory_files = {relative for relative, parts in parsed.items() if parts[1] == "f"}
    if set(approved) != inventory_files:
        raise SystemExit("approved files do not equal complete sealed inventory")
    for relative in approved:
        if relative == "." or relative.startswith("/") or ".." in pathlib.PurePosixPath(relative).parts:
            raise SystemExit("approved path is not relative")
        parts = parsed.get(relative)
        if not parts or parts[1] != "f":
            raise SystemExit("approved artifact is not a regular file")
        print("\t".join(parts))
else:
    raise SystemExit("usage: create|verify|approved ROOT SEAL [APPROVED_RELATIVE_FILES...]")
