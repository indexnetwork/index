# CLI Tools

This directory contains various command-line utilities for managing the Index protocol.

## Available Commands

### Database Management

#### `db:seed`
Seeds the database with sample data.
```bash
yarn db:seed
```

#### `db:flush`
Flushes/clears the database.
```bash
yarn db:flush
```

### Integration Management

#### `trigger-integration`
Manually triggers an integration sync.
```bash
# Development
yarn trigger-integration

# Production
yarn trigger-integration:prod
```

### Slack Tools

#### `export-slack`
Exports Slack messages from channels to JSON files.

**Options:**
- `--user-id <id>`: User ID (or set USER_ID env var)
- `--connected-account-id <id>`: Connected account ID (or set CONNECTED_ACCOUNT_ID env var)
- `--channels <channels>`: Comma-separated list of channel names (leave empty for all)
- `--output-dir <dir>`: Output directory (default: `./slack-exports`)
- `--start-date <date>`: Start date (YYYY-MM-DD) for message history
- `--batch-size <size>`: Number of messages per API call (default: 15)
- `--silent`: Suppress non-error output

**Examples:**
```bash
# Export all channels
yarn export-slack --user-id abc123 --connected-account-id xyz789

# Export specific channels
yarn export-slack --user-id abc123 --connected-account-id xyz789 --channels "general,random"

# Export with date filter
yarn export-slack --user-id abc123 --connected-account-id xyz789 --start-date 2024-01-01

# Using environment variables
export USER_ID=abc123
export CONNECTED_ACCOUNT_ID=xyz789
yarn export-slack
```

#### `import-slack-export`
Imports Slack messages from an exported JSON file into the protocol.

**Options:**
- `<file>`: Path to the exported Slack JSON file (required)
- `--integration-id <id>`: Integration ID (or set INTEGRATION_ID env var)
- `--user-id <id>`: User ID (or set USER_ID env var)
- `--index-id <id>`: Index ID (or set INDEX_ID env var)
- `--batch-size <size>`: Number of messages to process per batch (default: 50)
- `--json`: Output machine-readable JSON
- `--silent`: Suppress non-error output

**Examples:**
```bash
# Using command-line options
yarn import-slack-export ./slack-export-general-2024-11-10.json --integration-id abc123 --user-id xyz789

# Using environment variables
export INTEGRATION_ID=abc123
export USER_ID=xyz789
yarn import-slack-export ./slack-export-general-2024-11-10.json

# With all options
yarn import-slack-export ./data.json \
  --integration-id abc123 \
  --user-id xyz789 \
  --index-id def456 \
  --batch-size 100

# JSON output
yarn import-slack-export ./data.json --json
```



### Maintenance

#### `audit-freshness`
Audits the freshness of intents in the system.
```bash
yarn audit-freshness
```

#### `reset-brokers`
Resets broker agents (context brokers).
```bash
yarn reset-brokers
```

## Workflow: Slack Export → Import

To export Slack messages and import them into Index:

1. **Get your IDs** from the database:
   ```sql
   SELECT userId, connectedAccountId 
   FROM userIntegrations 
   WHERE integrationType = 'slack' AND status = 'connected';
   ```

2. **Export messages** from Slack:
   ```bash
   export USER_ID=<your-user-id>
   export CONNECTED_ACCOUNT_ID=<your-connected-account-id>
   yarn export-slack --channels "kernel-asks,kernel-intros"
   ```

3. **Import messages** into Index:
   ```bash
   export INTEGRATION_ID=<your-integration-id>
   export USER_ID=<your-user-id>
   export INDEX_ID=<your-index-id>  # optional
   yarn import-slack-export ./slack-exports/slack-export-kernel-asks-2024-11-10.json
   ```

## Development Notes

- All CLI commands use `TS_NODE_TRANSPILE_ONLY=1` for faster TypeScript compilation
- Production commands (`:prod` suffix) run from the compiled `dist/` directory
- Commands follow the Commander.js pattern for consistent argument parsing
- Environment variables can be used instead of command-line arguments for convenience

