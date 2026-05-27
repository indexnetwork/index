# Setup

The CLI is shipped as the public package
`@geoprotocol/geo-edge-esmeralda-cli`. Run it with `npx` from any environment
with Node 20+ and npm available.

Required configuration:

```bash
export EDGEOS_BEARER_TOKEN="..."          # Human session JWT for Geo knowledge graph access and content writes
```

Keep bearer tokens in environment/config only.

Copy this folder into `~/.hermes/skills/` or include it through an external
AgentSkills directory such as `~/.agents/skills`.

Run an auth check first:

```bash
npx -y @geoprotocol/geo-edge-esmeralda-cli auth
```
