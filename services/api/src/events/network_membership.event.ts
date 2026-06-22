/**
 * Hook called when a user is added to a network.
 * Set by main.ts to enqueue profile HyDE job so discovery can find the member.
 */
export const NetworkMembershipEvents = {
  onMemberAdded: (_userId: string, _networkId: string): void => {},
};
