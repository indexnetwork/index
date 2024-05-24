import Plausible from "plausible-tracker";

const plausible = Plausible({
  domain: "index.network",
});

const events = {
  WALLET_CONNECTED: "wallet_connected",
  INDEX_CREATED: "index_created",
  CHAT_STARTED: "chat_started",
  ITEM_ADDED: "item_added",
  ITEM_STARRED: "item_starred",
};

const trackEvent = (name: string, props?: Record<string, any>) => {
  if (process.env.NEXT_PUBLIC_API_URL === "https://index.network/api") {
    plausible.trackEvent(name, props);
  }
};

export const WALLET_CONNECTED = events.WALLET_CONNECTED;
export const INDEX_CREATED = events.INDEX_CREATED;
export const CHAT_STARTED = events.CHAT_STARTED;
export const ITEM_ADDED = events.ITEM_ADDED;
export const ITEM_STARRED = events.ITEM_STARRED;

export { trackEvent };
