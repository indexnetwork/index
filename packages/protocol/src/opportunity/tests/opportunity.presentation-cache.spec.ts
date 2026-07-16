import { describe, expect, it } from "bun:test";

import { OPPORTUNITY_PRESENTATION_CACHE_VERSION, buildApiChatCardPresentationCacheKey, buildDeliveryCardPresentationCacheKey, buildHomeCardPresentationCacheKey, buildHomeCategoryPresentationCacheKey } from "../opportunity.presentation-cache.js";

describe("opportunity presentation cache namespace", () => {
  it("versions every presentation key family with v2", () => {
    expect(OPPORTUNITY_PRESENTATION_CACHE_VERSION).toBe("v2");
    expect(buildHomeCardPresentationCacheKey("opp", "pending", "viewer"))
      .toBe("home:v2:card:opp:pending:viewer");
    expect(buildHomeCategoryPresentationCacheKey("viewer", "hash"))
      .toBe("home:v2:categories:viewer:hash");
    expect(buildDeliveryCardPresentationCacheKey("opp", "pending", "viewer"))
      .toBe("delivery:v2:card:opp:pending:viewer");
    expect(buildApiChatCardPresentationCacheKey("opp", "viewer"))
      .toBe("chat:v2:card:opp:viewer");
  });
});
