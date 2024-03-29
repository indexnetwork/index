<h1 align="center">
    <a href="https://index.network/#gh-light-mode-only">
    <img style="width:400px" src="https://index.network/images/IndexNetworkLogo.png">
    </a>
    <a href="https://index.network/#gh-dark-mode-only">
    <img style="width:400px" src="https://index.network/images/IndexNetworkLogo-white.png">
    </a>
</h1>
<p align="center">
  <i align="center">Create and monetize interoperable discovery engines. 🚀</i>
</p>

# Quick start

Index Network API allows you to interact with our platform and build products leveraging our services. Below, you will find detailed information about the available endpoints, their purposes, and how to use them.

You can either use the API directly or the client available. Here is a quick start to discover it.

### Using Index Client SDK

The Index Network offers an SDK to facilitate various operations on our platform. In this example, we'll demonstrate how to authenticate, create an Index, and add an Item to it.

> [**Index**](https://docs.index.network/docs/getting-started/data-models#index) is a fundamental component of the Index Network, designed to facilitate context management and enable semantic interoperability within your system. It serves as a structured way to organize and store data related to specific contexts.

> [**Item**](https://docs.index.network/docs/getting-started/data-models#indexitem) represents a graph node within an Index. It provides a standardized approach to representing and managing various types of data.

First, install the index-client via your preferred package manager:

`yarn add @indexnetwork/sdk`

Next, import it in your project:

```typescript
import IndexClient from "@indexnetwork/sdk";
```

Create an instance of `IndexClient`:

```typescript
const indexClient = new IndexClient({
  privateKey: "0xc45...a5",
  domain: "index.network",
  network: "ethereum", // provide your network
});
```

For authentication, you need a `DIDSession`. You can either sign in using a wallet or pass an existing session. Check [Authentication](../api-reference/identity/authentication.md) for details explanation on how to initiate a session.

```typescript
indexClient.authenticate();
```

We're almost ready. Now, let's create an Index, with a title.

```typescript
const indexId = await indexClient.createIndex({
  title: "Future of publishing",
});
```

Voilà, now you have a truly decentralized index to interact with! Though it's empty, which means we need to create and add an [`Item`](../api-reference/indexing/item.md) into it so we can interact. Let's do that.

```typescript
const webPageId = await indexClient.createWebPage({
  title: "Post medium publishing",
  url: "http://www.paulgraham.com/publishing.html",
});

await indexClient.addIndexItem(indexId, webPageId);
```

Your index is now ready for interaction! Querying the index is straightforward:

```typescript
const queryResponse = await indexClient.query({
  query: "summarize",
  indexes: [indexId], // you can add all the indexes of a user as well
});

console.log("Query response:", queryResponse);
```

The response should look something like this:

```typescript
{
  "response": "This article discusses the intricacies and challenges of publishing ... strategies for successful online publishing."
  "sources": [
    {
      "itemId": "kjzl6kcy...ii7z1anybovo",
      "indexId": "rt38xm13...b2ca76w5ky27",
    }
  ]
}
```
