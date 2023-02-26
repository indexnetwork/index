# TODO

# Auth
- [x] use did-session
- [x] use did-pkh
- [] Use Basic Profile

# Indexer
- [x] Index Indexer
- [x] Link Indexer

# Search
- [x] Index Search
- [x] Link Search
- [x] Validations & Error Handling

# ComposeDB UI
- [x] Create Index
- [x] Get Index
- [x] Get Links (Search links page 1)
- [x] Add Link
- [x] Make added link visible (Furkan)
- [x] Remove link
- [x] Search links & paginate
- [x] Update Index Title
- [x] Update Link Tags

# Secondary
- [x] Created at
- [x] Updated at (Topic update with last link update date.) /Only in elastic
- [] Duplicate URL Check (Insert or Query)
- [x] Character issue
- [x] Deleted at

# User Indexes
- [] Add/Remove index from user indexes UI
- [x] UserIndex UI (Seren)
- [x] UserIndex Indexer
- [x] UserIndex Composedb
- [x] DID Search

# Tertiary
- [x] Highlights
- [] Optimize query matching

# Crawlers
- [x] Index Link Metadata
- [x] Index Link Content

# Later
- [] Sort links (With furkan)
- [] Filtered Search
- [] Update Link Title
- [] Discovered indexes

# Devops
- [x] Ceramic Node Deployment
- [x] ComposeDB Deployment
- [x] Consumer Deployment
- [x] API Deployment
- [x] Ingress + Cors
- [x] Auto Deployment


# Collaboration
- [] PKP Mint 
- [] Craete default with pkp, with default action.
- [] Create new action
- [] Associate a PKP with a new LIT Action
- [] Conditional Signing 
- [] Collaboration UI (Seren)


# Security
- [] Protect composedb ingress.

https://github.com/indexas/backend-api/blob/626dbdef6bf381e3d65ce55e178e3ec205a02cff/src/services/elastic-service/query.ts



- Requests from composedb

* I desperately need cryptographically verifiable updated_at, created_at, deleted_at fields.
* Will ComposeDB support defining unique keys? Eliminating duplicate records at querying might be a solution.
Since we use Lit PKP owned streams, we store a bloom filter in another stream and evaluate validations using Lit Actions. 
I wonder your plans on this.

* Encryption composite: Everyone stores encrypted data differently. What's your thoughts on building a composite named "Encrypted" that conforms to certain standards. 
* Are you going to keep models in ComposeDB too? I can't think of a better discovery method.
