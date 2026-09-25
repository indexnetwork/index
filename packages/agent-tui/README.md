# agent-tui

An owner-facing terminal view of the live Index personal-agent workflow. It uses the same API client, presenter mapping, and session-authenticated requests as `apps/mac`: signal selection, agent messages and pending questions, radar opportunities, read-only agent negotiations, and accepting/passing an awaiting opportunity. It does not run an agent or simulate users; start the API and your chosen agent runtime separately.

```sh
bun install
bun run --cwd packages/cli dev login local # or login dev / login prod; switching replaces the saved session
bun run agent:tui
```

The TUI uses the CLI login's saved API origin and session; `INDEX_API_URL` can override that origin. Set `INDEX_SESSION_TOKEN` too when providing a session for another origin. A session token is required. **An agent API key is not an owner credential:** with a selected executor it speaks as the agent in the agent DM. This TUI will not use one. Like macOS, it reads existing owner data; it never seeds or resets it.

Tab and Shift+Tab switch among full-width agent inbox, radar, and negotiation views, so the UI remains readable in a Zellij pane. Ctrl+X changes signal; Ctrl+R pauses/resumes discovery. In the inbox, Left/Right cycles pending questions when the message field is empty, and Up/Down chooses an answer option. Enter sends a selected answer or the typed message; Ctrl+J inserts a newline. In Radar, Up/Down selects a card; `a` accepts or `x` passes one awaiting you, then repeat the key to confirm. Esc cancels confirmation. Ctrl+C exits. These controls avoid both macOS Option/Alt configuration and Zellij's default Ctrl+S, Ctrl+P, and Ctrl+Q bindings. Sending shows an in-progress row, then a saved-on-server notice until the agent responds; errors retain the draft. A paused signal holds its agent and discovery, so a saved message will not be processed until the signal resumes. Data refreshes on relevant server events and every five seconds.

Source: `src/api.ts` connects the mac API client and CLI session convention; `src/tui.ts` owns the terminal's navigation and render lifecycle; `src/main.ts` owns terminal lifetime. No TUI state or API policy is imported into the macOS app. The root ESLint and this package's typecheck are the source checks.
