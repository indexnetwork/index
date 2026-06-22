#!/usr/bin/env python3
"""Assemble the editable src/ tree into a single self-contained Resources/index.html.

Mirror of the desktop HaloApp assembler, pointed at the mobile sources
(src/halo-mobile.html + src/halo-mobile/*.jsx). Inlines the vendored
React/ReactDOM/Babel and every JSX module so the WKWebView never fetches a
sibling over file:// (unreliable on iOS) and the app stays fully offline.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "Resources" / "index.html"

# Pinned CDN URLs -> local vendored files.
VENDOR = {
    "https://unpkg.com/react@18.3.1/umd/react.development.js": "react.development.js",
    "https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js": "react-dom.development.js",
    "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js": "babel.min.js",
}

html = (SRC / "halo-mobile.html").read_text()


def inline_script(js_path: Path, attrs: str = "") -> str:
    code = js_path.read_text()
    if "</script" in code:
        raise SystemExit(f"refusing to inline {js_path}: contains </script")
    space = (" " + attrs.strip()) if attrs.strip() else ""
    return f"<script{space}>\n{code}\n</script>"


# 1) Replace the three CDN <script src="..."> by inlined vendored libs.
for url, fname in VENDOR.items():
    pat = re.compile(r'<script\b[^>]*\bsrc="' + re.escape(url) + r'"[^>]*></script>')
    if not pat.search(html):
        raise SystemExit(f"could not find CDN script tag for {url}")
    html = pat.sub(lambda _m, f=fname: inline_script(SRC / "vendor" / f), html, count=1)

# 2) Replace each <script type="text/babel" src="halo-mobile/NAME.jsx"></script> by inlined JSX.
def babel_sub(m):
    rel = m.group(1)
    return inline_script(SRC / rel, attrs='type="text/babel"')

html = re.sub(
    r'<script\s+type="text/babel"\s+src="(halo-mobile/[^"]+\.jsx)"></script>',
    babel_sub,
    html,
)

# Sanity: no remaining external src references into our local tree.
leftover = re.findall(r'src="(halo-mobile/[^"]+)"', html)
if leftover:
    raise SystemExit(f"unresolved local src refs remain: {leftover}")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html)
print(f"wrote {OUT} ({len(html):,} bytes)")
