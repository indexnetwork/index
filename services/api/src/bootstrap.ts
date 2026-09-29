import { setLoggerFactory, setRequestContextStore, setTimingWrapper } from '@indexnetwork/protocol';

import { OpportunityDatabaseAdapter } from './adapters/opportunity.database.adapter';
import { OpportunityEvents } from './events/opportunity.event';
import { log, sanitizeForLog } from './lib/log';
import { requestContext as hostRequestContext } from './lib/request-context';
import { traceAppOperation } from './lib/sentry-performance';
import { publishUserEvent } from './lib/user-events';
import { OpportunityEventService } from './services/opportunity-event.service';

// Wire the protocol library's logging into the rich API logger (context colors,
// emoji, LOG_LEVEL, Sentry, embedding redaction + payload truncation).
// Protocol loggers are late-bound, so this upgrades loggers created at import time too.
setLoggerFactory(
  (context, source) => log.withContext(context as Parameters<typeof log.withContext>[0], source),
  sanitizeForLog,
);

setTimingWrapper((name, fn) => traceAppOperation(
  {
    name,
    op: 'protocol.phase',
    attributes: {
      subsystem: 'protocol',
      'code.function': name,
    },
  },
  fn,
));

setRequestContextStore(hostRequestContext);

const opportunityEventAdapter = new OpportunityDatabaseAdapter();
const opportunityEventService = new OpportunityEventService({
  opportunities: opportunityEventAdapter,
  getIdentity: (userId) => opportunityEventAdapter.getProfile(userId),
  publish: publishUserEvent,
});

// Assign callbacks before starting workers to avoid a race with jobs already in Redis.
OpportunityEvents.onActionable = (payload) => opportunityEventService.publishOpportunityActionable(payload);
