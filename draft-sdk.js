class IndexNetworkClient {
  // Digital Identity (DID) Endpoints
  getIndexesByDID(did, type) { } // type is optional
  addIndexToDID(did, indexId, type) { }
  removeIndexFromDID(did, indexId, type) { }
  updateProfile(profileData) { } // profileData includes fields like name, bio, avatar
  getCurrentUserProfile() { }
  getProfileByDID(did) { }

  // Index Endpoints
  getIndexQuestions(indexId) { }
  getIndexById(indexId, includeRoles = false) { }
  createIndex(indexData) { } // indexData includes title, signerPublicKey, signerFunction
  updateIndex(indexId, indexData) { }
  deleteIndex(indexId) { }

  // Item Endpoints
  listItemsInIndex(indexId, queryParams = {}) { } // queryParams can include limit, cursor, query
  addItemToIndex(indexId, itemId) { }
  removeItemFromIndex(indexId, itemId) { }
  getIndexesByItemId(itemId) { }

  // Embedding Endpoints
  listEmbeddings(queryParams = {}) { } // queryParams can include indexId, itemId, etc.
  createEmbedding(embeddingData) { } // embeddingData includes indexId, itemId, etc.
  updateEmbedding(embeddingData) { }
  deleteEmbedding(embeddingData) { } // embeddingData includes indexId, itemId, etc.

  // Discovery Endpoints
  searchIndexes(searchParams) { } // searchParams includes query, indexIds, etc.
  chatForDiscovery(chatData) { } // chatData includes id, messages, did, indexIds

  // Web2 and Web Page Endpoints
  createWebPage(webPageData) { } // webPageData includes title, favicon, url, content
  getWebPageById(id) { }
  crawlWebPage(url) { }
  crawlWebPageMetadata(url) { }

  // Lit Protocol Endpoints
  getLitProtocolAction(cid) { }
  postLitProtocolAction(actionData) { } // actionData includes conditions

  // NFT and ENS Endpoints
  getNFTMetadata(chainName, tokenAddress, tokenId = null) { }
  getWalletByENS(ensName) { }

  // Site Endpoints
  uploadAvatar(file) { }
  accessSiteFaucet(address) { }
}

// Usage Example:
const client = new IndexNetworkClient();
client.getIndexesByDID("did:example:123", "own");
client.createIndex({ title: "My New Index", signerPublicKey: "0x123...", signerFunction: "Qm..." });
