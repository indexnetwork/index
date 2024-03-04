# Quick Start

Index Network API allows you to interact with our platform and build products leveraging our services. Below, you will find detailed information about the available endpoints, their purposes, and how to use them.

You can either use our API directly or the client available. Here is a quick start to discover it.


## Using Index Client SDK

The Index Network offers an SDK to facilitate various operations on our platform. In this example, we'll demonstrate how to authenticate, create an Index, and add an Item to it.


> **Index** is a fundamental component of the Index Network, designed to facilitate context management and enable semantic interoperability within your system. It serves as a structured way to organize and store data related to specific contexts.

> **Item** represents a graph node within an Index. It provides a standardized approach to representing and managing various types of data.

First, install the index-client via your preferred package manager:

```yarn add @index/index-client```

Next, import it in your project:


```
import Index from "@index/index-client"
```

Create an instance of ```IndexClient```:

```
const indexClient = new Index({
  network: "testnet" // provide your network
});
```

For authentication, you need a **DIDSession**. You can either sign in using a wallet or pass an existing session:

```
const session = indexClient.authenticate(); // you can pass a session as well
```

We're almost ready. Now, let's create an Index. You will need a title, along with **signerPublicKey** and **signerFunction**:

```
const indexId = await indexClient.createIndex({
  title: "Future of publishing",
  signerPublicKey: "0x047d...165",
  signerFunction: "QmaDZ...PhKBm"
});
```

> **SignerPublicKey**: This public key verifies the authenticity of operations on the index. It's obtained through litService.mintPKP(), which generates a public/private key pair.

> **SignerFunction** This CID that points a function defines the rules or procedures that must be followed when signing transactions or operations associated with the index.


Voilà, now you have a truly decentralized index to interact with! Though it's empty, which means we need to create and add an **Item** into it so we can interact. Let's do that.

```
const webPageId = await indexClient.createWebPage({
  title: "Post medium publishing",
  url: "http://www.paulgraham.com/publishing.html"
});

await indexClient.addIndexItem(indexId, webPageId);
```

Your index is now ready for interaction! Querying the index is straightforward:


```
const queryResponse = await indexClient.query({
  query: "summarize",
  indexes: [indexId] // you can add all the indexes of a user as well
});

console.log("Query response:", queryResponse);
```

The response should look something like this:

```
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

To explore additional functionalities, such as item removal, profile creation, and more, please visit our complete documentation.



## Before Starting

Things you should know to fully access the power of Index Network:

### Index
Index is a fundamental component of the Index Network, designed to facilitate context management and enable semantic interoperability within your system. It serves as a structured way to organize and store data related to specific contexts.

### Item
Item represents a graph node within an Index. It provides a standardized approach to representing and managing various types of data.

### Interaction
Index Network provides a chat stream to interact with Indexes and its items. You can also interact with all the indexes of a user.

### Cryptography
To achieve fully data-centric structure, we use cryptographic keys. You will need that when creating index or handling collaboration settings.

### SignerPublicKey
The public key is used to verify the authenticity of actions performed on the index. It is generated through the litService.mintPKP() function, which creates a new public/private key pair.

### SignerFunction
This function defines the rules or procedures that must be followed when signing transactions or operations associated with the index.


## Authentication
Most endpoints require authentication. Users should authenticate via DID session and include a valid bearer token in the request header.

## Error Handling
All endpoints respond with appropriate HTTP status codes. In case of an error, a JSON response containing an error message will be returned.

## Rate Limits
The API enforces rate limits to ensure fair usage. Please refer to the response headers for your current rate limit status.
