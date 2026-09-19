import { spawn, spawnSync } from 'bun';

const servers = ['dev:api', 'dev:web'].map((script) => spawn(['bun', 'run', script], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
  detached: true,
}));

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    // Include nested shells and Bun's watch process, not just the script wrapper.
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') {
      // macOS reports EPERM for groups containing only unreaped zombies.
      const ps = spawnSync(['ps', '-A', '-o', 'pgid=,stat=']);
      if (ps.exitCode === 0 && !ps.stdout.toString().trim().split('\n').some((line) => {
        const [group, state] = line.trim().split(/\s+/);
        return Number(group) === pid && !state.startsWith('Z');
      })) return false;
    }
    throw error;
  }
}

const exitCode = await Promise.race([
  ...servers.map((server) => server.exited),
  new Promise<number>((resolve) => {
    process.on('SIGHUP', () => resolve(129));
    process.on('SIGINT', () => resolve(130));
    process.on('SIGTERM', () => resolve(143));
  }),
]);

await Promise.all(servers.map(async (server) => {
  signalGroup(server.pid, 'SIGTERM');
  // Wrappers can exit before their descendants finish releasing ports.
  const deadline = Date.now() + 5000;
  while (signalGroup(server.pid, Date.now() < deadline ? 0 : 'SIGKILL')) {
    await Bun.sleep(50);
  }
  await server.exited;
}));
process.exit(exitCode);
