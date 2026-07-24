import { apiClient } from '@/lib/api';

/**
 * Resolve the existing negotiator DM session id, or null when none exists or
 * the lookup fails. Navigation hints never create a session here — callers
 * fall back to /questions, where pending consultations are also answerable.
 */
export async function getNegotiatorDmSessionId(): Promise<string | null> {
  try {
    const { sessions } = await apiClient.get<{ sessions: { id: string }[] }>('/chat/sessions?persona=negotiator');
    return sessions?.[0]?.id ?? null;
  } catch {
    return null;
  }
}
