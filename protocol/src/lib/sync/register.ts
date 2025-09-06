import { registerProvider } from './queue';
import { linksProvider } from './providers/links';
import { createIntegrationProvider } from './providers/integrations';

export function registerSyncProviders() {
  registerProvider(linksProvider);
  registerProvider(createIntegrationProvider('notion'));
  registerProvider(createIntegrationProvider('gmail'));
  registerProvider(createIntegrationProvider('slack'));
  registerProvider(createIntegrationProvider('discord'));
  registerProvider(createIntegrationProvider('calendar'));
}
