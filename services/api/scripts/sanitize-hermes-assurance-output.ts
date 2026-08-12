import { sanitizeHermesAssuranceOutput } from '../src/lib/testing/hermes-assurance-output';

process.stdout.write(sanitizeHermesAssuranceOutput(await Bun.stdin.text()));
