const mode = process.argv[2];
if (mode === 'fail') {
  console.log('raw stdout secret=should-not-leak');
  console.error('raw stderr secret=should-not-leak');
  process.exit(23);
}
console.log(JSON.stringify({
  pid: process.pid,
  args: process.argv.slice(2),
  databaseUrl: process.env.DATABASE_URL,
  neonApiKeyPresent: 'NEON_API_KEY' in process.env,
  manifestPresent: 'DISCOVERY_ENV_MATRIX_CHILDREN' in process.env,
}));
