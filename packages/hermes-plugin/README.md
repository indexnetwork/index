# Hermes Plugin Template Generator

Scaffold a Hermes plugin directory with `plugin.yaml`, Python registration code, tool schemas, handlers, and bundled skill examples.

This package follows Hermes' documented plugin model. Generated plugins are meant to live under `$HERMES_HOME/plugins/<name>` or another directory you choose, then be explicitly enabled with `hermes plugins enable <name>`.

## Scope

- Generates a neutral Hermes plugin template.
- Includes an example tool and an example bundled skill.
- Does not configure MCP servers.
- Does not create scheduled cron jobs.
- Does not enable generated plugins unless you pass `--enable`.
