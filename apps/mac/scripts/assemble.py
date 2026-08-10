#!/usr/bin/env python3
"""Assemble the editable src/ tree into a single self-contained Resources/index.html.

Source of truth is src/index.html + src/ui/**/*.jsx (editable).
This inlines the vendored React/ReactDOM/Babel, theme CSS, each JSX module, and the
webfonts directly, so the WebView never has to fetch siblings over file://
(unreliable in WKWebView) and the app stays fully offline.
"""
import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "Resources" / "index.html"
API_DIR = ROOT / "api"
# Concatenated in this order into one IIFE, so a module must come before the
# ones that use it. Their cross-imports are stripped below: sharing a scope is
# what replaces them here, while the files keep real imports so `bun test api/`
# can load any of them on its own.
API_MODULES = ("socials.mjs", "client.mjs", "mappers.mjs", "deeplink.mjs", "radar-state.mjs")
API_EXPORTS = [
    "createIndexApiClient", "IndexApiError", "normalizeApiBaseUrl", "toQueryString",
    "mapIndexSnapshot", "mapIntents", "mapIntent",
    "mapPeopleFromRadarItems", "mapPersonFromRadarCard", "mapPeopleFromOpportunities",
    "mapCounterpartProfile", "mapSocials",
    "mapClarifiers", "mapClarifier", "mapOpportunityStatusToPrototype", "mapEventSummary",
    "sameRadarPeople", "applyRadarPeople",
    "parseDeepLink", "isIndexDeepLink",
    "SOCIAL_PREFIX", "EDITABLE_PLATFORMS", "parseSocial", "firstSocialValue",
    "socialPlatformOf", "socialHandleOf", "socialHrefOf", "socialApiLabelOf",
    "buildSocialHref", "normalizeSocial", "splitProfileSocials", "buildProfileSocials",
]

# `import { x } from './y.mjs';` — dropped, since y.mjs is already in scope.
LOCAL_IMPORT = re.compile(
    r"^import\s+[^;]*?\s+from\s+['\"]\./[^'\"]+\.mjs['\"];?[ \t]*\n",
    re.MULTILINE,
)

VENDOR = {
    "https://unpkg.com/react@18.3.1/umd/react.development.js": "react.development.js",
    "https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js": "react-dom.development.js",
    "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js": "babel.min.js",
    "https://unpkg.com/marked@18.0.7/lib/marked.umd.js": "marked.umd.js",
}

html = (SRC / "index.html").read_text()


def inline_script(js_path: Path, attrs: str = "") -> str:
    code = js_path.read_text()
    if "</script" in code:
        raise SystemExit(f"refusing to inline {js_path}: contains </script")
    space = (" " + attrs.strip()) if attrs.strip() else ""
    return f"<script{space}>\n{code}\n</script>"


for url, fname in VENDOR.items():
    pat = re.compile(r'<script\b[^>]*\bsrc="' + re.escape(url) + r'"[^>]*></script>')
    if not pat.search(html):
        raise SystemExit(f"could not find CDN script tag for {url}")
    html = pat.sub(lambda _m, f=fname: inline_script(SRC / "vendor" / f), html, count=1)


def build_index_api() -> str:
    parts = []
    for fname in API_MODULES:
        code = (API_DIR / fname).read_text()
        if "</script" in code:
            raise SystemExit(f"refusing to inline {fname}: contains </script")
        code = LOCAL_IMPORT.sub("", code)
        if re.search(r"^\s*import\s", code, flags=re.MULTILINE):
            raise SystemExit(f"{fname} has an import the bundle cannot resolve")
        code = re.sub(r'^export\s+', '', code, flags=re.MULTILINE)
        parts.append(code)
    assigns = ", ".join(f"{name}: {name}" for name in API_EXPORTS)
    body = "\n".join(parts) + f"\nwindow.IndexApi = {{ {assigns} }};\n"
    return f"<script>\n(function(){{\n{body}\n}})();\n</script>"


anchor = '<script type="text/babel" src="ui/primitives/tokens.jsx"></script>'
if anchor not in html:
    raise SystemExit("could not find the first babel script tag to inject IndexApi before")
html = html.replace(anchor, build_index_api() + "\n" + anchor, 1)


def babel_sub(m):
    rel = m.group(1)
    return inline_script(SRC / rel, attrs='type="text/babel"')


html = re.sub(
    r'<script\s+type="text/babel"\s+src="(ui/[^"]+\.jsx)"></script>',
    babel_sub,
    html,
)

css_link = '<link rel="stylesheet" href="styles/amiga.css">'
css_path = SRC / "styles" / "amiga.css"
if css_link not in html:
    raise SystemExit("could not find styles/amiga.css link in index.html")
if not css_path.is_file():
    raise SystemExit("missing src/styles/amiga.css")
css = css_path.read_text()
if "</style" in css:
    raise SystemExit("refusing to inline CSS: contains </style")
html = html.replace(css_link, f"<style>\n{css}\n</style>", 1)


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
    raise SystemExit("no @font-face url() references found, did the CSS change?")

leftover = re.findall(r'src="(ui/[^"]+)"', html)
if leftover:
    raise SystemExit(f"unresolved local src refs remain: {leftover}")

stragglers = re.findall(r'url\("(?!data:)([^"]+)"\)', html) + re.findall(
    r'https://fonts\.(?:googleapis|gstatic)\.com', html
)
if stragglers:
    raise SystemExit(f"unresolved font refs remain: {stragglers}")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html)
print(f"wrote {OUT} ({len(html):,} bytes)")
