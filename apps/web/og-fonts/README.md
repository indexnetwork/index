The profile link thumbnail implements option **1b · dialog stack** from the
user-provided `Thumbnail Options.html` Claude Design export (project
`ecee6307-c4aa-4dec-b751-e5db6dfb3a82`, imported `Thumbnail B Dialog.dc.html`).
The export's `support.js` is a design-canvas runtime; production renders the
selected layout directly to PNG in `profile-thumbnail.ts` without that runtime.

These IBM Plex fonts were extracted from the export's embedded Latin WOFF2
fonts and converted to TrueType for the server renderer. The Sans variable font
was instantiated at weight 700. Mono uses the original Medium and SemiBold
family names. See `OFL.txt` for the SIL Open Font License.

Production serves `/profile-preview/:username.png` (also accepts a user ID).
Profile pages at `/:username` and `/u/:id` get server-rendered Open Graph and
Twitter metadata. The server uses `VITE_PROTOCOL_URL`, defaulting to the
production protocol origin, and its anonymous `/api/users/:id` endpoint.
Images and profile data are cached for five minutes with a 100-entry bound.
Uploaded avatars and known social-provider avatar hosts are supported; missing,
failed, or unsupported avatar URLs render the person's initial instead.
