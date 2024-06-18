<h1 align="center">
    <a href="https://index.network/#gh-light-mode-only">
    <img style="width:400px" src="https://index.network/images/IndexNetworkLogo.png">
    </a>
    <a href="https://index.network/#gh-dark-mode-only">
    <img style="width:400px" src="https://index.network/images/IndexNetworkLogo-white.png">
    </a>
</h1>
<p align="center">
  <i align="center">Discovery Protocol 🚀</i>
</p>

# Quick start

Index is a discovery protocol that eliminates the need for intermediaries in finding knowledge, products, and like-minded people through direct, composable discovery across the web. As the first decentralized semantic index, it leverages Web3 and AI and offers an open layer for discovery.

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
// Init your wallet
const wallet = new Wallet(process.env.PRIVATE_KEY);

const indexClient = new IndexClient({
  wallet,
  network: "dev", // or mainnet
});
```

For authentication, you need a `DIDSession`. You can either sign in using a wallet or pass an existing session. Check [Authentication](../api-reference/identity/authentication.md) for details explanation on how to initiate a session.

```typescript
await indexClient.authenticate();
```

We're almost ready. Now, let's create an Index, with a title.

```typescript
const indexId = await indexClient.createIndex(title: "Future of publishing");
```

Great, now you have a truly decentralized index to interact with! Though it's empty, which means we need to create and add an [`Item`](../api-reference/indexing/item.md) into it so we can interact. Let's do that.

```typescript
const webPageId = await indexClient.crawlWebPage({
  url: "http://www.paulgraham.com/publishing.html",
});

await indexClient.addItemToIndex(indexId, webPageId);
```

Your index is now ready for interaction! To start a conversation and interact with the data, follow these steps:

```typescript
// Create a conversation
const conversationParams = {
  sources: [index.id],
  summary: "Mock summary",
  members: [indexClient.wallet.address],
};
const conversation = await indexClient.createConversation(conversationParams);

// Add a message to the conversation
const messageParams = {
  role: "user",
  content: "How do you do this?",
};
const message = await indexClient.createMessage(conversation.id, messageParams);

// Retrieve messages from the conversation
const messages = await indexClient.getItems(conversation.id, {});
console.log(messages);
```

The response should look something like this:

```typescript
{
  "id": "message-id",
  "content": "How do you do this?",
  "role": "user",
  "createdAt": "timestamp"
}
```

### Listening to Conversation Updates

The Index Client SDK allows you to listen for updates to a conversation in real-time. This is useful for applications that need to react to new messages or changes in a conversation.

Here is an example of how you can use the `listenToConversationUpdates` method to handle real-time updates in a conversation:

```typescript
const conversationId = "your-conversation-id";

const handleMessage = (data: any) => {
  console.log("New message received:", data);
  // Handle the new message data
};

const handleError = (error: any) => {
  console.error("Error receiving updates:", error);
  // Handle the error
};

const stopListening = indexClient.listenToConversationUpdates(
  conversationId,
  handleMessage,
  handleError,
);
```
