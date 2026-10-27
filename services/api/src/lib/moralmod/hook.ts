/**
 * Assembles the MoralMod NegotiateHook from configuration, or nothing at all:
 * without MORALMOD_ASSESSMENT_URL the hosted agent runs exactly as before.
 */

import type { NegotiateHook } from '@indexnetwork/agent';
import { createAssessmentClient, createMoralmodHook } from '@indexnetwork/moralmod';

import { moralmodConfig } from './config';
import { createExposureSink } from './exposure';
import { networkArm } from './network-arm';
import { log } from '../log';

const logger = log.lib.from('moralmod');

/** @returns The hook for members of the configured network, or null when unconfigured. */
export function buildMoralmodHook(): NegotiateHook | null {
  const config = moralmodConfig();
  if (!config.assessmentUrl) return null;
  logger.info('MoralMod hook enabled', { assessmentUrl: config.assessmentUrl, networkKey: config.networkKey, templateId: config.templateId, maxConcurrent: config.maxConcurrentConsults });
  return createMoralmodHook({
    arm: networkArm(config.networkKey),
    client: createAssessmentClient({ baseUrl: config.assessmentUrl, token: config.assessmentToken }),
    templateId: config.templateId,
    deadlineMs: config.consultDeadlineMs,
    maxConcurrent: config.maxConcurrentConsults,
    emit: createExposureSink({ relayUrl: config.relayUrl, relayToken: config.relayToken }),
    log: (line) => logger.verbose(line),
  });
}
