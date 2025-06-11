import db from '../../lib/db';
import { agents } from '../../lib/schema';
import { eq } from 'drizzle-orm';
import { ExampleContextBroker } from './example/integration';

// Context broker interface
interface ContextBroker {
  name: string;
  onIntentCreated: (intentId: string) => Promise<void>;
  onIntentUpdated: (intentId: string, previousStatus?: string) => Promise<void>;
  onIntentArchived: (intentId: string) => Promise<void>;
}

// Registry of all available context brokers
const CONTEXT_BROKERS: ContextBroker[] = [
  new ExampleContextBroker(),
];

/**
 * Trigger all registered context brokers when a new intent is created
 */
export async function triggerBrokersOnIntentCreated(intentId: string): Promise<void> {
  console.log(`🎯 Triggering ${CONTEXT_BROKERS.length} context brokers for new intent: ${intentId}`);
  
  const brokerPromises = CONTEXT_BROKERS.map(async (broker) => {
    try {
      console.log(`🚀 Starting broker: ${broker.name} for intent: ${intentId}`);
      await broker.onIntentCreated(intentId);
      console.log(`✅ Broker ${broker.name} completed for intent: ${intentId}`);
    } catch (error) {
      console.error(`❌ Broker ${broker.name} failed for intent ${intentId}:`, error);
    }
  });

  await Promise.allSettled(brokerPromises);
  console.log(`🏁 All brokers finished processing intent: ${intentId}`);
}

/**
 * Trigger all registered context brokers when an intent is updated
 */
export async function triggerBrokersOnIntentUpdated(intentId: string, previousStatus?: string): Promise<void> {
  console.log(`🎯 Triggering ${CONTEXT_BROKERS.length} context brokers for updated intent: ${intentId}`);
  
  const brokerPromises = CONTEXT_BROKERS.map(async (broker) => {
    try {
      console.log(`🔄 Starting broker: ${broker.name} for updated intent: ${intentId}`);
      await broker.onIntentUpdated(intentId, previousStatus);
      console.log(`✅ Broker ${broker.name} completed for updated intent: ${intentId}`);
    } catch (error) {
      console.error(`❌ Broker ${broker.name} failed for updated intent ${intentId}:`, error);
    }
  });

  await Promise.allSettled(brokerPromises);
  console.log(`🏁 All brokers finished processing updated intent: ${intentId}`);
}

/**
 * Trigger all registered context brokers when an intent is archived
 */
export async function triggerBrokersOnIntentArchived(intentId: string): Promise<void> {
  console.log(`🎯 Triggering ${CONTEXT_BROKERS.length} context brokers for archived intent: ${intentId}`);
  
  const brokerPromises = CONTEXT_BROKERS.map(async (broker) => {
    try {
      console.log(`📦 Starting broker: ${broker.name} for archived intent: ${intentId}`);
      await broker.onIntentArchived(intentId);
      console.log(`✅ Broker ${broker.name} completed for archived intent: ${intentId}`);
    } catch (error) {
      console.error(`❌ Broker ${broker.name} failed for archived intent ${intentId}:`, error);
    }
  });

  await Promise.allSettled(brokerPromises);
  console.log(`🏁 All brokers finished processing archived intent: ${intentId}`);
}

/**
 * Register a new context broker
 */
export function registerContextBroker(broker: ContextBroker): void {
  CONTEXT_BROKERS.push(broker);
  console.log(`📝 Registered new context broker: ${broker.name}`);
}

/**
 * Get list of registered context brokers
 */
export function getRegisteredBrokers(): string[] {
  return CONTEXT_BROKERS.map(broker => broker.name);
}

/**
 * Get broker count for monitoring/debugging
 */
export function getBrokerCount(): number {
  return CONTEXT_BROKERS.length;
} 