# API Endpoints

## Digital Identity (DID) Endpoints
- GET /dids/:did/indexes/:type?: Retrieve indexes associated with a DID.
- PUT /dids/:did/indexes/:indexId/:type: Add an index to a DID.
- DELETE /dids/:did/indexes/:indexId/:type: Remove an index from a DID.
- PATCH /profile: Update the profile of the authenticated user.
- GET /profile: Get the profile of the authenticated user from session.
- GET /dids/:did/profile: Fetch a profile by DID.

## Index Endpoints
- GET /indexes/:id/questions: Get questions related to an index.
- GET /indexes/:id: Retrieve an index by ID.
- POST /indexes: Create a new index.
- PATCH /indexes/:id: Update an existing index.
- DELETE /indexes/:id: Delete an index.

## Item Endpoints
- GET /indexes/:indexId/items: List items in an index.
- POST /indexes/:indexId/items/:itemId: Add an item to an index.
- DELETE /indexes/:indexId/items/:itemId: Remove an item from an index.
- GET /items/:itemId/indexes: Get indexes associated with an item.

## Embedding Endpoints
- GET /embeddings: List embeddings.
- POST /embeddings: Create a new embedding.
- PATCH /embeddings: Update an embedding.
- DELETE /embeddings: Delete an embedding.

## Discovery Endpoints
- POST /discovery/search: Search within indexes.
- POST /discovery/chat: Chat-based interaction for discovery.
Web2 and Web Page Endpoints
- POST /web2/webpage: Create a web page.
- GET /web2/webpage/:id: Get a web page by ID.
- POST /web2/webpage/crawl: Crawl a web page.
- GET /web2/webpage/metadata: Crawl metadata of a web page.

## Zapier and Lit Protocol Endpoints
- POST /zapier/index_link: (For future refactor)
- GET /zapier/auth: (For future refactor)
- GET /lit_actions/:cid: Get a Lit Protocol action.
- POST /lit_actions/: Post a Lit Protocol action.

## NFT and ENS Endpoints
- GET /nft/:chainName/:tokenAddress: Get metadata for a token collection.
- GET /nft/:chainName/:tokenAddress/:tokenId: Get metadata for a specific NFT.
- GET /ens/:ensName: Get wallet by ENS name.


## File and Site Endpoints
- POST /profile/upload_avatar: Upload an avatar image.
- POST /site/subscribe: Subscribe to a newsletter.
- GET /site/faucet: Access the site faucet.