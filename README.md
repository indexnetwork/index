<h1 align="center">
    <a href="https://amplication.com/#gh-light-mode-only">
    <img style="width:400px" src="https://dev.index.as/images/indexasLogo.png">
    </a>
    <a href="https://amplication.com/#gh-dark-mode-only">
    <img style="width:400px" src="https://dev.index.as/images/indexasLogo-white.png">
    </a>
</h1>

<p align="center">
  <i align="center">Create and monetize interoperable discovery engines. 🚀</i>
</p>

<h4 align="center">
  <a href="https://github.com/amplication/amplication/actions/workflows/ci.yml">
    <img src="https://github.com/indexas/web3-web-app/actions/workflows/build.yaml/badge.svg" alt="continuous integration">
  </a>
  <a href="https://github.com/indexas/web3-web-app/graphs/contributors">
    <img src="https://img.shields.io/github/contributors-anon/indexas/web3-web-app?color=yellow&style=flat-square" alt="contributers">
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/mit-blue.svg?label=license" alt="license">
  </a>
  <br>
  <a href="https://discord.gg/wvdxP6XvYu">
    <img src="https://img.shields.io/badge/discord-7289da.svg" alt="discord">
  </a>
  <a href="https://twitter.com/indexas">
    <img src="https://img.shields.io/badge/twitter-18a1d6.svg" alt="twitter">
  </a>
</h4>


## About index.as
index.as allows creators to make contextual discovery engines from their information. It enables data-ownership, collaboration, and monetization to form discovery ecosystem as a network.  It cultivates greater participation in decentralized discovery and creates diverse and inclusive ecosystem.

We use NFTs as creator roles for broader contexts with large groups. index.as is useful for creators​, communities, DAOs, brands, curators, researchers, enthusiasts.

## Table of contents
1. [Features](#features)
2. [Examples](#examples)
3. [Architecture overview](#architecture-overview)
4. [Components](#components)
5. [Getting started](#getting-started)
6. [Contributing](#contributing)
7. [Credits](#built-with-open-protocols)
8. [Resources](#resources)
9. [License](#license)

## Features 

- [x] Interoperable Indexes: Create an index by adding any relevant contents to the topic.
- [x] Search: Transform indexes into refined search engines.
- [x] Collaboration: Use NFTs as creator roles to enable broader contexts with large groups. ([Granted by LIT Protocol](https://github.com/LIT-Protocol/LitGrants/issues/37))
- [x] Creator Monetization: Utilize membership NFTs to earn revenue with complete autonomy.
- [ ] Launch Mainnet
- [ ] Enable 3rd-party Algorithms: Integrate with the LLMs, search algorithms.
- [ ] Integrations (eg. zapier)
- [ ] Token curated indexes
- [ ] Creator Monetization (private indexes)
- [x] New Schemas: Expand the supported schemas:
	- [x] Links
	- [ ] Videos
	- [ ] Products
	- [ ] NFTs
	- [ ] Events
	- [ ] Articles
- [ ] Schema-based custom filters: Filtering capabilities tailored for the new schemas
- [ ] Bundling: Allowing users to bundle multiple indexes together.
- [ ] Composable Queries: Query multiple indexes together w/o natural language.

## Examples
!TODO


## Architecture Overview

<picture>
	<source media="(prefers-color-scheme: dark)" srcset="https://dev.index.as/images/dataflow-black.png">
	<source media="(prefers-color-scheme: light)" srcset="https://dev.index.as/images/dataflow-white.png">
	<img alt="Dataflow" src="https://dev.index.as/images/dataflow-white.png">
</picture>

## Components

### Web App
The [Web App](https://github.com/indexas/web3-web-app) repository is where you can find the code for the index.as web application. The web app provides a user-friendly interface that allows creators to make discovery engines, manage their content, and configure them.

### Indexer
The [API](https://github.com/indexas/web3-api) repository hosts the code for the index.as backend. It acts as the backbone of the tool, providing the necessary methods to consume data from Ceramic, with PostgreSQL indexing. Uses Debezium to produce Apache Kafka and finally consumes to Elasticsearch by running `yarn kafka-consumer`  

### API 
The [API](https://github.com/indexas/web3-api) repository also hosts the code for search and metadata endpoints. To start, you can simply run `yarn api`

### Ceramic Network Node
ComposeDB on Ceramic is a composable graph database built for Web3.  Here you can find the steps to deploy along with an IPFS Node:
https://composedb.js.org/docs/0.4.x/guides/composedb-server

We built four different schemas to store information on Ceramic:
- Index _[(view model)](https://s3.xyz/models/modelview/kjzl6hvfrbw6c8e8rlhx3guuoc1o6i4vni5emzh2c48aa5pn0u71jggun7rtu2a?network=TESTNET)_
- Link _[(view model)](https://s3.xyz/models/modelview/kjzl6hvfrbw6c72mna95slfmi9nth1fp3bacc2ai7i6g1scygmo7awxsjl4dlpk?network=TESTNET)_
- IndexLink _[(view model)](https://s3.xyz/models/modelview/kjzl6hvfrbw6c6vpgfoph7e98nkj4ujmd7bgw5ylb6uzmpts1yjva3zdjk0bhe9?network=TESTNET)_
- UserIndex _[(view model)](https://s3.xyz/models/modelview/kjzl6hvfrbw6c5gi8p8j811v4u9tpel9m9lo11hm9ks74c1l0fhmnebsbtwusso?network=TESTNET)_

### IPFS Node
ComposeDB on Ceramic is a composable graph database built for Web3.  Here you can find the steps to deploy along with an IPFS Node:
https://composedb.js.org/docs/0.4.x/guides/composedb-server

### Others
We use [PostgreSQL](https://www.postgresql.org/) indexing feature of [Ceramic Network](https://ceramic.network/) and use [KafkaConnect CDC](https://docs.confluent.io/cloud/current/connectors/cc-postgresql-source.html) to produce db changes to [Apache Kafka](https://kafka.apache.org/) and finally write data to [Elasticsearch](https://www.elastic.co/) via the consumer service.


## Getting started

Indexes are ComposeDB documents that stores the main information of an Index. Currently all indexes are owned by LIT PKPs (Programmable Key Pair) to have NFT based access control options.

#### Initialize the ComposeDB Client
```
import { ComposeClient } from '@composedb/client'
import { DID } from 'dids'
import { Ed25519Provider } from 'key-did-provider-ed25519'
import { getResolver } from 'key-did-resolver'
import { fromString } from 'uint8arrays/from-string'

const CERAMIC_HOST = "https://ceramic-testnet.index.as"
const CERAMIC_ADMIN_KEY = "<YOUR_CERAMIC_ADMIN_KEY>"

const privateKey = fromString(CERAMIC_ADMIN_KEY, 'base16') 
const did = new DID({
  resolver: getResolver(),
  provider: new Ed25519Provider(privateKey),
})
await did.authenticate()

import { definition } from "indexas_definition.js";

const compose = new ComposeClient({ ceramic: CERAMIC_HOST, definition })
compose.setDID(did)
```

### Create Index
```
const index = await compose.executeQuery(`
  mutation CreateIndex($input: CreateIndexInput!) {
    createIndex(input: $input) {
      document {
        id
        title
        collabAction
        pkpPublicKey
        createdAt
        updatedAt
      }
    }
  }
`,
{
    "i": {
      "content": {
        "did": "did:key:zQ3shviNesaR4tePLzV5dAe3VhyMxMkCu2jgwwKZ9fSCikQ8E", 
        "title": "My first index", 
        "collabAction": "QmSBSz4GFaEskvbcRdbJVMzwbe9K2yxWsDHPn8Yh29WLRG",
        "pkpPublicKey": "Your PKP Public Key",
        "created_at": "2023-06-27T00:00:00Z", 
        "updated_at": "2023-06-27T00:00:00Z", 
      }
    }
  }
);
```
### Create a Link
```
const link = await compose.executeQuery(`
  mutation CreateLink($input: CreateLinkInput!) {
    createLink(input: $input) {
      document {
        id
        controllerDID{
          id
        }
        url
        title
        tags
        favicon
        createdAt
        updatedAt
        deletedAt
      }
    }
  }
`,
{
    "i": {
      "content": {
        "url": "https://testnet.index.as", 
        "title": "index.as", 
        "tags": ["no-code", "discovery tools"],
        "favicon": "https://testnet.index.as/favicon-white.png",
        "created_at": "2023-06-27T00:00:00Z", 
        "updated_at": "2023-06-27T00:00:00Z", 
      }
    }
  }
);
```

### Associate created Link with the Index
```
const indexLink = await compose.executeQuery(`
  mutation CreateIndexLink($input: CreateIndexLinkInput!) {
    createIndexLink(input: $input) {
      document {
        id
        indexerDID {
          id
        }
        controllerDID {
          id
        }
        indexId
        linkId
        createdAt
        updatedAt
        deletedAt
        link {
          id
          controllerDID {
            id
          }
          title
          url
          favicon
          tags
          content
          createdAt
          updatedAt
          deletedAt
        }
      }
    }
  }
`,
{
    "i": {
      "content": {
        "indexId": index.id, 
        "linkId": link.id, 
        "indexerDID": did.id,
        "created_at": "2023-06-27T00:00:00Z", 
        "updated_at": "2023-06-27T00:00:00Z",
      }
    }
  }
);
```
## Contributing

First of all, thanks for thinking of contributing to this project. :
Before sending a Pull Request, please make sure that you're assigned the task on a GitHub issue.
- If a relevant issue already exists, discuss on the issue and get it assigned to yourself on GitHub.
- If no relevant issue exists, open a new issue and get it assigned to yourself on GitHub.

And join our community to get support, provide feedback, or just to say hello on...

## Built with Open Protocols

Index.as leverages the power of several open protocols to enhance its capabilities:

- [**Ceramic**](https://ceramic.network/): Ceramic is a decentralized data network that brings unlimited data composability to Web3 applications. It enables Index.as to leverage the decentralized data network and utilize its features in building discovery engines.
- [**Lit Protocol**](https://litprotocol.com/): Lit Protocol is a decentralized access control infrastructure designed to bring more utility to the web. Index.as integrates Lit Protocol to provide enhanced access control features, allowing creators to have fine-grained control over their data.
- [**IPFS**](https://ipfs.io/): IPFS (InterPlanetary File System) is a peer-to-peer hypermedia protocol designed to preserve and grow humanity's knowledge by making the web upgradeable, resilient, and more open. Index.as utilizes IPFS to store and distribute data, ensuring its availability and resilience.

## Resources

-   **[index.as](https://index.as)**  to explore the app.
-   **[Discord](https://discord.gg/wvdxP6XvYu)**  for support and discussions with the community and the team.
-   **[GitHub](https://github.com/indexas/indexas)**  for source code, project board, issues, and pull requests.
-   **[Twitter](https://twitter.com/indexas)**  for the latest updates on the product and published blogs.

## License
index.as is under the MIT license. See the  [LICENSE](https://github.com/indexas/indexas/blob/main/LICENSE)  for more information.
