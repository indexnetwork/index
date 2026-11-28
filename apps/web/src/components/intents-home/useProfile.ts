import { useEffect, useState } from "react";

import { useUsers } from "@/contexts/APIContext";

export interface Profile {
  username?: string | null;
  intro?: string | null;
  location?: string | null;
  socials?: Array<{ label: string; value: string }> | null;
  /** False for someone who isn't on Index yet (a ghost). */
  emailVerified?: boolean;
}

/** Profiles once loaded, so the header and the summary don't each fetch one. */
const profileCache = new Map<string, Promise<Profile>>();
export function useProfile(userId?: string): Profile | null {
  const users = useUsers();
  const [state, setState] = useState<{ id: string; profile: Profile } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let pending = profileCache.get(userId);
    if (!pending) {
      pending = users.getUserProfile(userId).then((p) => p as Profile);
      pending.catch(() => profileCache.delete(userId));
      profileCache.set(userId, pending);
    }
    pending.then((profile) => { if (active) setState({ id: userId, profile }); }).catch(() => {});
    return () => { active = false; };
  }, [userId, users]);
  return state && state.id === userId ? state.profile : null;
}
