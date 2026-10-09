#!/usr/bin/env bun
/**
 * Drive the Ghost network by hand.
 *
 * Usage (from the repository root):
 *   bun run ghost init <owner-email>   Create the network; prints the id for GHOST_NETWORK_ID
 *   bun run ghost seed                 Research and open ghost counterparties for member signals
 *   bun run ghost outreach             Email ghosts whose match a member accepted
 *   bun run ghost opt-out <email>      Remove a ghost who replied "stop"
 */
import '@indexnetwork/api/src/startup.env';
import '@indexnetwork/api/src/bootstrap';

import { closeDb } from '@indexnetwork/api/src/lib/drizzle/drizzle';

import { createGhostNetwork, optOut, outreachPass, seedPass } from './ghost';

const [command, arg] = process.argv.slice(2);

try {
  if (command === 'init' && arg) {
    console.log(`[ghost] Created network ${await createGhostNetwork(arg)}. Set it as GHOST_NETWORK_ID.`);
  } else if (command === 'seed') {
    console.log(`[ghost] Paired ${await seedPass()} ghost opportunities.`);
  } else if (command === 'outreach') {
    console.log(`[ghost] Sent ${await outreachPass()} outreach emails.`);
  } else if (command === 'opt-out' && arg) {
    console.log(`[ghost] ${await optOut(arg) ? 'Removed' : 'No unclaimed ghost with'} ${arg}.`);
  } else {
    console.error('Usage: ghost init <owner-email> | seed | outreach | opt-out <email>');
    process.exitCode = 1;
  }
} catch (error) {
  console.error('[ghost]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closeDb();
}
process.exit();
