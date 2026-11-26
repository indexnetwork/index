import { useEffect, useState } from "react";

import { apiClient } from "@/lib/api";
import { isHandlePath } from "@/lib/handle-route";
import { readPendingPair } from "@/lib/pending-pair";
import { networksService } from "@/services/networks";
import { getPublicUserProfile } from "@/services/users";

/** What the sign-in page says about why the visitor is here. */
export interface SignInReason {
  title: string;
  meta: string;
}

const DEFAULT: SignInReason = {
  title: "sign in to index",
  meta: "index finds the right people for you, before you even think to look.",
};

function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "them";
}

/** What can be said from the path alone, before any lookup. */
function fromPath(path: string): SignInReason | null {
  if (path.startsWith("/o/")) return { title: "sign in to see your introduction", meta: "it opens your chat with them as soon as you're in." };
  if (/^\/u\/[^/]+\/chat/.test(path)) return { title: "sign in to open your chat", meta: "you'll be back in the conversation right after." };
  if (path.startsWith("/i/")) return { title: "sign in to see this intent", meta: DEFAULT.meta };
  if (path.startsWith("/networks")) return { title: "sign in to see your networks", meta: DEFAULT.meta };
  if (path.startsWith("/introduce")) return { title: "sign in to introduce people", meta: DEFAULT.meta };
  return null;
}

/**
 * Why `next` sent someone to sign in, worded for the page: the network an
 * invite or network link joins, the person a "pair agents" click pairs with,
 * the introduction or chat a link opens. Falls back to the plain sign-in.
 */
export function useSignInReason(next: string): SignInReason {
  const [reason, setReason] = useState<SignInReason>(() => fromPath(next) ?? DEFAULT);

  useEffect(() => {
    let active = true;
    const set = (r: SignInReason) => { if (active) setReason(r); };
    const url = new URL(next, window.location.origin);
    const path = url.pathname;

    const invite = path.match(/^\/l\/([^/]+)/);
    // Only the emails to people not on Index send a profile through sign-in: someone wants to meet them.
    const person = path.match(/^\/u\/([^/]+)\/?$/);
    if (person) {
      getPublicUserProfile(decodeURIComponent(person[1]))
        .then((p) => set({ title: `sign in to meet ${firstName(p.name)}`, meta: "use the email this link came to. you'll see why they want to meet, and can say yes or pass." }))
        .catch(() => {});
    } else if (invite) {
      networksService.getNetworkByShareCode(decodeURIComponent(invite[1]))
        .then((n) => set({ title: `sign in to join ${n.title}`, meta: "you're invited. once you're in, you're a member." }))
        .catch(() => {});
    } else if (isHandlePath(path)) {
      const handle = path.split("/")[1];
      apiClient.getPublic<{ handle: { kind: "user" | "network"; id: string; title?: string } }>(`/handles/${encodeURIComponent(handle)}`)
        .then(async ({ handle: holder }) => {
          if (holder.kind === "network") {
            set({ title: `sign in to join ${holder.title}`, meta: "once you're in, you're a member." });
            return;
          }
          if (readPendingPair()?.userId !== holder.id) return;
          const person = await getPublicUserProfile(holder.id);
          set({ title: `sign in to pair agents with ${firstName(person.name)}`, meta: "your agents keep talking in the background, and bring you together when something's worth meeting over." });
        })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [next]);

  return reason;
}
