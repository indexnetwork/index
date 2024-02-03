
<h1 align="center">
    <a href="https://amplication.com/#gh-light-mode-only">
    <img style="width:400px" src="https://index.network/images/IndexNetworkLogo.png">
    </a>
    <a href="https://amplication.com/#gh-dark-mode-only">
    <img style="width:400px" src="https://index.network/images/IndexNetworkLogo-white.png">
    </a>
</h1>

<p align="center">
  <i align="center">Composable discovery protocol 🚀</i>
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


## About Index Network
Index is a composable discovery protocol that allows to create  truly personalized and autonomous discovery experiences across the web. 

To achieve this, Index provides a decentralized semantic index that eliminates data fragmentation, a composable discovery protocol that allows data to be queried from multiple sources, in a user-centric manner. On top of this, it provides a real-time environment for agents that facilitates integration with algorithms and services and ensures that information acquires a fluid, social, and autonomous structure.

## Table of contents
1. [Examples](#examples)
3. [Components](#components)
4. [Getting started](#getting-started)
5. [Contributing](#contributing)
6. [Credits](#built-with-open-protocols)
7. [Resources](#resources)
8. [License](#license)


## Example
!TODO


## Components

### Web App
The [Web App](web-app) component is where you can find the code for the  web application. The web app provides a user-friendly interface that allows creators to explore indexes, manage their data, and configure them.

### Indexer
The [Indexer](indexer) component hosts the code for the indexer. It acts as the backbone of the natural language operations, providing the necessary methods to consume data from Ceramic, interact with large language models.  It listenes Apache Kafka to consume Ceramic Network events consumes to ChromaDB by running `yarn kafka-consumer`  

### API 
The [API](api) repository also hosts the code for all the API operations To start, you can simply run `yarn api`  

Full protocol documentation can be found on the  [Index Network documentation site →](https://index-network.gitbook.io/

### Ceramic Network Node
ComposeDB on Ceramic is a composable graph database built for Web3.  Here you can find the steps to deploy along with an IPFS Node:
[https://composedb.js.org/docs/0.6.x/guides/composedb-server](https://composedb.js.org/docs/0.6.x/guides/composedb-server)

### IPFS Node
ComposeDB on Ceramic is a composable graph database built for Web3.  Here you can find the steps to deploy along with an IPFS Node:
[https://composedb.js.org/docs/0.6.x/guides/composedb-server](https://composedb.js.org/docs/0.6.x/guides/composedb-server)

### Others
We use [PostgreSQL](https://www.postgresql.org/) indexing feature of [Ceramic Network](https://ceramic.network/) and use [KafkaConnect CDC](https://docs.confluent.io/cloud/current/connectors/cc-postgresql-source.html) to produce db changes to [Apache Kafka](https://kafka.apache.org/) and finally write data to [ChromaDB](https://www.trychroma.com/) via the consumer service.


## Data Models
Index Network uses 6 different schemas to store information on Ceramic Network:

| Model      | ID                                                                                   |
|------------|---------------------------------------------------------------------------------------|
| Index      | kjzl6hvfrbw6c6wr91bqjojw1znltqso445kevew3hiywjl1ior4fga60arj9xo                      |
| IndexItem  | kjzl6hvfrbw6c66p7dxhk35uass66v2q42b2sdbaw7smitphfv60y9tux4obxu4                      |
| Embedding  | kjzl6hvfrbw6c5wx4eb9mmw2su1q7y4m65wd8m887ulubbfn5iawpy6ukprq4va                      |
| WebPage    | kjzl6hvfrbw6c5ehmhlme25mhizo670ro6jeu6h50m9fqnie4phkqy9vip8w8t0                      |
| DIDIndex   | kjzl6hvfrbw6c7wlj08gruhq6gkatb8heg07btxzzeotumzpkftsnmxrf51l0b0                      |
| Profile    | kjzl6hvfrbw6c6a1qzykoqwu191lnpci1z6kp7ww18dycm9ono1r37un63my1hd                      |

### Index 
Rrepresents a collection of items around a specific context, acting as a structured way to organize and access related information. `Index` includes fields for a title, a signer's public key, and timestamps for creation, updates, and deletion. The inclusion of `signerPublicKey` and  `signerFunction` specifies  the use of decentralized access control mechanism through Lit Protocol, which enables secure access based on cryptographic conditions. 

### IndexItem
Establishes a relationship between an index and its nodes within a graph, essentially linking the metadata or content stored in an index to individual data points or nodes. Each `IndexItem` is associated with a specific `Index` and a `Node` on ComposeDB, tracked by their respective IDs, and it includes timestamps for creation, updates, and deletion. This model facilitates navigating from an abstract index to concrete items or nodes, making it a crucial component for organizing and retrieving data in a structured manner within a decentralized context.

### Embedding 

The `Embedding` model is focused on storing vector embeddings for items within an index, where each embedding represents high-dimensional data reduced to vectors for efficient similarity searches or machine learning applications. It includes a model name, the vector itself, optional context, description, category, and links to the related `Index` and `Node`.  Very soon, the embedding model will facilitate the interoperability of vector embeddings to enable exchange of semantic information across various AI models.

### WebPage Model

While Index supports any node on the ComposeDB graph, the `WebPage` model is an example for developers to explore and interact with the Index Network. It provides a simple structure for storing information about web pages, including title, favicon, URL, and content, along with timestamps for creation, updates, and deletion. This model is aimed at archiving web content in a decentralized manner, allowing for the retrieval and display of web page information within the Index Network. It facilitates the indexing and searching of web content, contributing to a decentralized web archive or search engine capability.

### DIDIndex Model

The `DIDIndex` model is specifically designed for indexing decentralized identifiers (DIDs), providing a way to associate DIDs with specific indexes and categorizing them by type. Each DID can own or star in an index, with the `controllerDID` field indicating the DID that controls or owns the index.

### Profile Model

The `Profile` model represents user profiles within the Index Network, containing personal information such as a controller DID, name, bio, and an optional avatar. This model allows for the creation of user-centric data within a decentralized framework, where the `controllerDID` serves as a unique identifier and access controller for the profile, emphasizing privacy and user control over personal information.

## Getting started

This code snippet demonstrates how to interact with the protocol using the Index client. It begins by initializing the client for and authenticating with a DID session. Then, it creates an index titled "Future of publishing" and a web page titled "Post medium publishing" with a specified URL. The code adds the web page to the index and performs a natural language query using the keyword "summarize," retrieving and displaying the natural language query response.

```js
const indexClient = new Index({
  network: "testnet"
});

indexClient.authenticate(session)

// Create an index
const indexId = await indexClient.createIndex({
  title: "Future of publishing",
  signerPublicKey: "0x047955f0df748d..1708fc8c965",
  signerFunction: "QmaD9FZJYst2Tntf9UwSd3QUeD68XpaPhKBSyy5wWLHq2m"
});

// Create a web page
const webPageId = await indexClient.createWebPage({
  title: "Post medium publishing",
  url: "http://www.paulgraham.com/publishing.html"
});

// Add the web page to the index
await indexClient.addIndexItem(indexId, webPageId);

// Perform a natural language query
const queryResponse = await indexClient.query({
  query: "summarize",
  indexes: [indexId]
});

console.log("Query response:", queryResponse);
```

## Contributing

First of all, thanks for thinking of contributing to this project. Before sending a Pull Request, please make sure that you're assigned the task on a GitHub issue.
- If a relevant issue already exists, discuss on the issue and get it assigned to yourself on GitHub.
- If no relevant issue exists, open a new issue and get it assigned to yourself on GitHub.

And join our community to get support, provide feedback, or just to say hello on...

## Built with Open Protocols

Index Network leverages the power of several open protocols to enhance its capabilities:

- [**Ceramic**](https://ceramic.network/): Ceramic is a decentralized data network that brings unlimited data composability to Web3 applications. It enables Index Network to leverage the decentralized data network and utilize its features in building discovery engines.
- [**Lit Protocol**](https://litprotocol.com/): Lit Protocol is a decentralized access control infrastructure designed to bring more utility to the web. Index Network integrates Lit Protocol to provide enhanced access control features, allowing creators to have fine-grained control over their data.
- [**IPFS**](https://ipfs.io/): IPFS (InterPlanetary File System) is a peer-to-peer hypermedia protocol designed to preserve and grow humanity's knowledge by making the web upgradeable, resilient, and more open. Index Network utilizes IPFS to store and distribute data, ensuring its availability and resilience.

## Resources

-   **[Index Network](https://index.network)**  to explore the app.
-   **[Discord](https://discord.gg/wvdxP6XvYu)**  for support and discussions with the community and the team.
-   **[GitHub](https://github.com/indexas/indexas)**  for source code, project board, issues, and pull requests.
-   **[Twitter](https://twitter.com/indexas)**  for the latest updates on the product and published blogs.

## License
Index Network is under the MIT license. See the  [LICENSE](LICENSE)  for more information.
