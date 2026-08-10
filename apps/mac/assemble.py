#!/usr/bin/env python3
import runpy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
runpy.run_path(str(Path(__file__).resolve().parent / "scripts" / "assemble.py"), run_name="__main__")
