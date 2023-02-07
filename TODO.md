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
- [] Collaboration UI (Seren)
- [] Conditional Signing 
- [] PKP Mint 
- [] Create new action
- [] Associate a PKP with a LIT Action


# Security
- [] Protect composedb ingress.

https://github.com/indexas/backend-api/blob/626dbdef6bf381e3d65ce55e178e3ec205a02cff/src/services/elastic-service/query.ts



- Requests from composedb

* Urgent: Cryptographically verifiable updated_at, created_at, deleted_at
* Sorting & Filtering
* Unique Keys. Eh.
* Encryption composite
* Kafka Indexer?
* Extend schema (Profile, IndexasProfile)
* Why another statestore?
* I should be able to filter models by searching column names. 