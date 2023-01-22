# TODO

# Indexer
- [x] Index Indexer
- [x] Link Indexer

# Search
- [x] Index Search
- [x] Link Search
- [x] Validations & Error Handling

# ComposeDB UI
- [X] Create Index
- [X] Get Index
- [] Get Links
- [] Search links
- [] Update Index
- [] Add Link
- [] Update Link

# Secondary
- [] Remove link
- [] Filtered Search
- [] Sort links

# Devops
- [x] Ceramic Node Deployment
- [X] ComposeDB Deployment
- [] Consumer Deployment
- [] Search Service Deployment
- [] Ingress + Cors

# User Indexes
- [] UserIndex UI (Seren)
- [] UserIndex Indexer
- [] DID Search
- [] Remove index from user indexes

# Crawlers
- [] Index Link Metadata
- [] Index Link Content

# Collaboration
- [] Collaboration UI (Seren)
- [] Conditional Signing 
- [] PKP Mint 
- [] Create new action
- [] Associate a PKP with a LIT Action

https://github.com/indexas/backend-api/blob/626dbdef6bf381e3d65ce55e178e3ec205a02cff/src/services/elastic-service/query.ts



docker run --rm --name ceramic -p 7007:7007 ceramicnetwork/js-ceramic:dev daemon --port "7007" --hostname 0.0.0.0 --network dev-unstable --anchor-service-api https://cas-dev.3boxlabs.com --debug true --ethereum-rpc https://rinkeby.infura.io/v3/b6685df41e1647c4be0046dfa62a020b

 CERAMIC_ENABLE_EXPERIMENTAL_COMPOSE_DB="true"; ceramic daemon  --config ./composedb.config.json