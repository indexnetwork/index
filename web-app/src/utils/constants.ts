export const BREAKPOINTS = {
  xs: 480,
  sm: 768,
  md: 992,
  lg: 1200,
  xl: 1201,
};

export const DEFAULT_CREATE_INDEX_TITLE = "Untitled Index";
export const DEFAULT_CREATE_LINK_TITLE = "Untitled Link";

export const API_ENDPOINTS = {
  CHAT_STREAM: "/chat_stream",
  INDEXES: "/indexes",
  GET_ALL_INDEXES: "/dids/:id/indexes",
  GET_PROFILE: "/dids/:id/profile",
  SEARCH_LINKS: "/search/links",
  GET_USER_INDEXES: "/search/user_indexes",
  LIT_ACTIONS: "/lit_actions",
  CRAWL: "/crawl/metadata",
  CRAWL_CONTENT: "/links/crawl-content",
  FIND_CONTENT: "/links/find-content",
  SYNC_CONTENT: "/links/sync-content",
  NFT_METADATA: "/nft",
  ENS: "/ens",
  UPLOAD_AVATAR: "/upload_avatar",
  ZAPIER_TEST_LOGIN: "/zapier/test_login",
  SUBSCRIBE_TO_NEWSLETTER: "/subscribe",
};
