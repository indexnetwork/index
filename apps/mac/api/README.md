# Mac API client boundary

This folder is the standalone API-consumption boundary for the native macOS/iOS prototypes under `apps/mac`.

It is intentionally **not imported** by `HaloApp` or `HaloApp-iOS` yet. The current apps still use their local `window.HALO_DATA` fake data. Keep API transport, response normalization, and prototype-shape mappers here until we are ready to wire the web bundles to real backend data.

## Intended role

- Own calls to `services/api` (`/api/auth/me`, `/api/intents/list`, `/api/opportunities/home`, `/api/questions`, conversations, etc.).
- Convert backend DTOs into the existing prototype shapes (`INTENTS`, people/opportunity cards, clarifiers).
- Keep auth/token handling isolated from UI components.
- Preserve fake-data fallback in the app until an explicit integration step.

## Current files

- `client.mjs` — dependency-free fetch wrapper and resource methods for the Index API.
- `mappers.mjs` — pure mappers from API responses to the current mac prototype view models.
- `index.mjs` — barrel exports for future consumers.

## Non-goals for this first step

- No imports from `HaloApp/src/**` or `HaloApp-iOS/src/**`.
- No changes to generated `Resources/index.html` bundles.
- No Swift bridge or Keychain token implementation yet.
