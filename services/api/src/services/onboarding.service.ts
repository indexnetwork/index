import { log } from '../lib/log';
import { chatDatabaseAdapter, userDatabaseAdapter } from '../adapters/database.adapter';

const logger = log.service.from('OnboardingService');

export class OnboardingService {
  async confirmProfile(userId: string): Promise<{ profileConfirmedAt: string }> {
    const user = await userDatabaseAdapter.findById(userId);
    if (!user) throw new Error('User not found');

    const hasIdentity = Boolean(user.name?.trim() || user.intro?.trim());
    if (!hasIdentity) {
      throw new Error('Profile must include a name or intro before confirmation');
    }

    const onboarding = user.onboarding ?? {};
    const profileConfirmedAt = onboarding.profileConfirmedAt ?? new Date().toISOString();
    await userDatabaseAdapter.update(userId, {
      onboarding: {
        ...onboarding,
        profileConfirmedAt,
        currentStep: onboarding.completedAt
          ? onboarding.currentStep ?? 'complete'
          : 'first_intent',
      },
    });

    return { profileConfirmedAt };
  }

  async complete(userId: string, intentId?: string): Promise<{ completedAt: string; intentId: string }> {
    const user = await userDatabaseAdapter.findById(userId);
    if (!user) throw new Error('User not found');

    const currentOnboarding = user.onboarding ?? {};
    if (currentOnboarding.completedAt) {
      return {
        completedAt: currentOnboarding.completedAt,
        intentId: currentOnboarding.firstIntentId ?? intentId ?? '',
      };
    }

    if (!currentOnboarding.profileConfirmedAt) {
      throw new Error('Onboarding cannot be completed until the profile is confirmed');
    }

    const profileConfirmedAtMs = Date.parse(currentOnboarding.profileConfirmedAt);
    if (!Number.isFinite(profileConfirmedAtMs)) {
      throw new Error('Invalid profile confirmation timestamp');
    }

    const activeIntents = await chatDatabaseAdapter.getActiveIntents(userId);
    const isEligible = (intent: { id: string; createdAt: Date }) => {
      const createdAtMs = intent.createdAt.getTime();
      return Number.isFinite(createdAtMs) && createdAtMs >= profileConfirmedAtMs;
    };

    const firstIntent = intentId
      ? activeIntents.find((i) => i.id === intentId)
      : activeIntents.find(isEligible);

    if (!firstIntent) {
      throw new Error(intentId
        ? 'Confirmed first intent is not active for this user'
        : 'No eligible active intent after profile confirmation');
    }

    if (!isEligible(firstIntent)) {
      throw new Error('Selected first intent was created before profile confirmation');
    }

    const completedAt = new Date().toISOString();
    await userDatabaseAdapter.update(userId, {
      onboarding: {
        ...currentOnboarding,
        firstIntentId: firstIntent.id,
        currentStep: 'complete',
        completedAt,
      },
    });

    logger.info('Onboarding completed', { userId, intentId: firstIntent.id });
    return { completedAt, intentId: firstIntent.id };
  }
}

export const onboardingService = new OnboardingService();
