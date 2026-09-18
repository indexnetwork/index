# /web — the Workbench UI on the web

`index.network/web` serves the same screens as the macOS app (`apps/mac/src/ui`),
unchanged. Nothing else in the web app links to it yet, and no existing route
was touched to add it.

## How it fits together

| file | what it is |
| --- | --- |
| `page.tsx` | The route. Owns the stylesheet's lifetime and mirrors the site session onto the bridge. |
| `bridge.web.mjs` | The web half of `window.IndexApp`. Hand-written; the only file the mac and the web do not share. |
| `workbench.generated.jsx` | Generated. Every `apps/mac/src/ui/**` screen concatenated in load order. |
| `api/*.mjs`, `assets/*` | Generated. Verbatim copies of `apps/mac/api` and the mac's stylesheet, fonts and loader art. |

The screens never speak to a backend directly: they call `window.IndexApp` and
`window.IndexApi`. On the mac, `ui/bridge.jsx` implements that façade over
WKWebView message handlers with Swift holding the credential. Here,
`bridge.web.mjs` implements the same façade over `fetch` with the site's JWT
(`lib/auth-client`), and SSE over `EventSource`. That is the whole port — the
screens cannot tell which host they are running on.

Two differences follow from the host rather than from the UI:

- **Sign-in** is the site's modal, not a browser handshake into the Keychain.
- **Desktop-only capabilities are absent**, and the screens already know how to
  hide what the bridge does not offer: no open-at-login toggle, no protocol-server
  switch, and local agent runtimes report an empty inventory instead of the mac's
  demo rows. OS toasts become Web Notifications, and only once the user has
  granted permission.

## Changing the UI

Edit `apps/mac/src/ui/**` — it stays the single source of truth — then:

```bash
bun run build:workbench-web
```

The generated files are committed because the Railway web service only builds
`apps/web` (see `apps/web/railway.toml`), so a change under `apps/mac` alone
would not even trigger a deploy. Do not edit them by hand.

`apps/mac` keeps its own bundling (`scripts/assemble.py` inlines everything into
one offline HTML file); this route lets Vite do that job instead.
