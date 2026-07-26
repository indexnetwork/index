#!/usr/bin/env python3
"""Assemble the editable src/ tree into a single self-contained Resources/index.html.

Source of truth is src/index-amiga.html + src/index-amiga/*.jsx (editable).
This inlines the vendored React/ReactDOM/Babel, each JSX module, and the
webfonts directly, so the WebView never has to fetch siblings over file://
(unreliable in WKWebView) and the app stays fully offline.
"""
import base64
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "Resources" / "index.html"

# Pinned CDN URLs -> local vendored files (downloaded once into src/vendor/).
VENDOR = {
    "https://unpkg.com/react@18.3.1/umd/react.development.js": "react.development.js",
    "https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js": "react-dom.development.js",
    "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js": "babel.min.js",
}

html = (SRC / "index-amiga.html").read_text()


def inline_script(js_path: Path, attrs: str = "") -> str:
    code = js_path.read_text()
    if "</script" in code:
        raise SystemExit(f"refusing to inline {js_path}: contains </script")
    space = (" " + attrs.strip()) if attrs.strip() else ""
    return f"<script{space}>\n{code}\n</script>"


# 1) Replace the three CDN <script src="..."> (with integrity/crossorigin) by inlined vendored libs.
for url, fname in VENDOR.items():
    pat = re.compile(r'<script\b[^>]*\bsrc="' + re.escape(url) + r'"[^>]*></script>')
    if not pat.search(html):
        raise SystemExit(f"could not find CDN script tag for {url}")
    html = pat.sub(lambda _m, f=fname: inline_script(SRC / "vendor" / f), html, count=1)

# 2) Replace each <script type="text/babel" src="index-amiga/NAME.jsx"></script> by inlined JSX.
def babel_sub(m):
    rel = m.group(1)
    return inline_script(SRC / rel, attrs='type="text/babel"')

html = re.sub(
    r'<script\s+type="text/babel"\s+src="(index-amiga/[^"]+\.jsx)"></script>',
    babel_sub,
    html,
)

# 3) Replace each @font-face url("fonts/NAME.woff2") by an inline data: URI.
#    Fonts must be embedded rather than fetched, or the type silently falls back
#    to system faces whenever the app runs offline.
def font_sub(m):
    rel = m.group(1)
    path = SRC / rel
    if not path.is_file():
        raise SystemExit(f"missing font referenced by CSS: {rel}")
    data = path.read_bytes()
    if data[:4] != b"wOF2":
        raise SystemExit(f"{rel} is not a woff2 file (bad magic: {data[:4]!r})")
    b64 = base64.b64encode(data).decode("ascii")
    return f'url("data:font/woff2;base64,{b64}") format("woff2")'


html, n_fonts = re.subn(
    r'url\("(fonts/[^"]+\.woff2)"\)\s*format\("woff2"\)',
    font_sub,
    html,
)
if not n_fonts:
    raise SystemExit("no @font-face url() references found — did the CSS change?")

# Sanity: no remaining external src references into our local tree.
leftover = re.findall(r'src="(index-amiga/[^"]+)"', html)
if leftover:
    raise SystemExit(f"unresolved local src refs remain: {leftover}")

# Sanity: nothing may still point at the network or at a sibling file.
stragglers = re.findall(r'url\("(?!data:)([^"]+)"\)', html) + re.findall(
    r'https://fonts\.(?:googleapis|gstatic)\.com', html
)
if stragglers:
    raise SystemExit(f"unresolved font refs remain: {stragglers}")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html)
print(f"wrote {OUT} ({len(html):,} bytes)")
