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
- [] Updated at (Topic update with last link update date.)
- [] Duplicate URL Check (Insert or Query)
- [x] Character issue
- [] Deleted at

# User Indexes
- [] UserIndex UI (Seren)
- [x] UserIndex Indexer
- [] DID Search
- [] Remove index from user indexes

# Tertiary
- [] Sort links (With furkan)
- [] Filtered Search
- [] Highlights
- [] Optimize query matching
- [] Update Link Title

# Devops
- [x] Ceramic Node Deployment
- [x] ComposeDB Deployment
- [x] Consumer Deployment
- [x] API Deployment
- [x] Ingress + Cors
- [] Auto Deployment

# Crawlers
- [x] Index Link Metadata
- [] Index Link Content

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

* Cryptographically verifiable updated_at, created_at, deleted_at
* Sorting & Filtering
* Unique Keys
* Encryption composite
* Kafka Indexer?
