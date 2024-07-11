# Index Network Client SDK

## Quick start


Index is a discovery protocol that eliminates the need for intermediaries in finding knowledge, products, and like-minded people through direct, composable discovery across the web. As the first decentralized semantic index, it leverages Web3 and AI and offers an open layer for discovery.

You can either use the API directly or the client available. Here is a quick start to discover it.

### Using Index Client SDK

The Index Network offers an SDK to facilitate various operations on the protocol. In this example, we'll demonstrate how to authenticate, create an Index, and add an Item to it.

> [**Index**](https://docs.index.network/docs/getting-started/data-models#index) is a fundamental component of the Index Network, designed to facilitate context management and enable semantic interoperability within your system. It serves as a structured way to organize and store data related to specific contexts.

> [**Item**](https://docs.index.network/docs/getting-started/data-models#indexitem) represents a graph node within an Index. It provides a standardized approach to representing and managing various types of data.

First, install the index-client via your preferred package manager:

```shell
yarn add @indexnetwork/sdk
```

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
  domain: "https://dev.index.network",
  network: "dev", // or mainnet
});
```

For authentication, you need a `DIDSession`. You can either sign in using a wallet or pass an existing session. Check [Authentication](https://docs.index.network/docs/api-reference/identity/authentication) for details explanation on how to initiate a session.

```typescript
await indexClient.authenticate();
```

We're almost ready. Now, let's create an Index, with a title.

```typescript
const index = await indexClient.createIndex("Future of publishing");
```

Great, now you have a truly decentralized index to interact with! Though it's empty, which means we need to create and add an [`Item`](https://docs.index.network/docs/api-reference/indexing/index) into it so we can interact. Let's do that.

```typescript
const webPage = await indexClient.crawlWebPage("http://www.paulgraham.com/publishing.html");

await indexClient.addItemToIndex(index.id, webPage.id);
```

### Using Custom Schemas
If you want to use your own schema, you can do so by creating and deploying a custom model. Below are the methods and examples of how to use them.

#### Creating a Custom Model
Use the createModel method to create a custom model using a GraphQL schema.

```typescript

const modelResponse = await indexClient.createModel(`
  type CustomObject {
    title: String! @string(maxLength: 50)
  }

  type YourModel @createModel(accountRelation: LIST, description: "Full schema for models") {
    id: ID!
    booleanValue: Boolean!
    intValue: Int!
    floatValue: Float!
    did: DID!
    streamId: StreamID!
    commitId: CommitID!
    cid: CID!
    chainId: ChainID!
    accountId: AccountID!
    uri: URI! @string(maxLength: 2000)
    date: Date!
    dateTime: DateTime!
    time: Time!
    localDate: LocalDate!
    localTime: LocalTime!
    timeZone: TimeZone!
    utcOffset: UTCOffset!
    duration: Duration!
    stringValue: String! @string(maxLength: 10)
    objectArray: [CustomObject!] @list(maxLength: 30)
    singleObject: CustomObject
  }
`);

```

#### Deploying a Custom Model
After creating a custom model, use the deployModel method to deploy it.

```typescript
await indexClient.deployModel(modelResponse.models[0]);
```

#### Using Your Model
To use it, create a node with your model and required data.

```typescript
const sampleNodeData = { } // Fill with your data

const createdNode = await indexClient.createNode(
  modelResponse.models[0],
  sampleNodeData,
);

const newIndex = await indexClient.createIndex("Index with your model");

const addedItem = await indexClient.addItemToIndex(
  newIndex.id,
  createdNode.id,
);
```

## Interact with your index
Your index is now ready for interaction! To start a conversation and interact with the data, follow these steps:


```typescript
// Create a conversation
const conversationParams = {
  sources: [index.id],
  summary: "Mock summary",
};
const conversation = await indexClient.createConversation(conversationParams);

// Add a message to the conversation
const messageParams = {
  role: "user",
  content: "How do you do this?",
};
const message = await indexClient.createMessage(conversation.id, messageParams);

// Retrieve messages from the conversation
const { messages } = await indexClient.getConversation(conversation.id);
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

### Listening to Index Updates

The Index Client SDK allows you to listen for updates to miltiple indexes in real-time. This is useful for applications that need to react to new data events, using natural language.

Here is an example of how you can use the `listenToIndexUpdates` method to handle real-time updates in a conversation:

```typescript
const sources = ["did:pkh:eip155:1:0x1b9Aceb609a62bae0c0a9682A9268138Faff4F5f"];

const query = "if it is relevant to decentralized AI";

const handleMessage = (data: any) => {
  console.log("New event received:", data);
  // Handle the new message data
};

const handleError = (error: any) => {
  console.error("Error receiving updates:", error);
  // Handle the error
};

const stopListening = indexClient.listenToIndexUpdates(
  sources,
  query
  handleMessage,
  handleError,
);
```
