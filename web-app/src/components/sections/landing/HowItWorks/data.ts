const data = [
  {
    content: `Create a semantic index where you can add your data, knowledge, research, products, and more.
    <br/>
    <br/>
    Decentralized agents will generate and maintain your vector embeddings, summarizing entities and facts.
    <br/>
    <br/>
    Your index functions as a decentralized vector database, enabling natural language interactions.`,
    codeBlock: `const index = await client.createIndex({
  title: "Publishing"
});

const document = await client.createDocument({
  title: "The future of publishing",
  body: "Publishers of all types, from news to music,
  are unhappy that consumers won't pay for content
  anymore. At least, that's how they see it."
});

await client.addItemToIndex(index.id, document.id);

const response = await client.query({
  "What is the future of publishing?"
});`,
  },
  {
    content: `Query multiple indexes using natural language with any model to receive knowledge-linked responses.
    <br/>
    <br/>
    Treat your index like a blog, but a composable one. Share it with your users, customers, and peers, allowing them to explore and discover your knowledge.
    <br/>
    <br/>
    With native integrations into the new semantic web ecosystem, compose your queries with other indexes for social graphs, knowledge graphs, reputation graphs, and more.`,
    codeBlock: `const index = await client.createIndex({
  title: "Publishing"
});

const document = await client.createDocument({
  title: "The future of publishing",
  body: "Publishers of all types, from news to music, are
  unhappy that consumers won't pay for content anymore.
  At least, that's how they see it."
});

await client.addItemToIndex(index.id, document.id);

const response = await client.query({
  "What is the future of publishing?"
});`,
  },
  {
    content: `Invite both agents and other users into conversations with the multiplayer conversations, bringing multiple agents a variety of economic models and methods to cooperate and enhance relevance. Your conversations are in your control, with blockchain backed privacy. 
<br/>
<br/>
    Initiate public conversations that are contextually discoverable by others, making each conversation visible within other people's conversations or anywhere else it is contextually relevant.
`,
    codeBlock: `const index = await client.createIndex({
  title: "Publishing"
});

const document = await client.createDocument({
  title: "The future of publishing",
  body: "Publishers of all types, from news to music, are
  unhappy that consumers won't pay for content anymore.
  At least, that's how they see it."
});

await client.addItemToIndex(index.id, document.id);

const response = await client.query({
  "What is the future of publishing?"
});`,
  },
  {
    content: `Index enables listening to events in indexes contextually with a "contextual pub/sub" functionality. It allows subscribing to contexts using natural language queries, such as simply saying, "tell me if something new happens about quantum computing," to trigger an autonomous agent. This natural language event allows a network of agents to work together independently and reactively.
`,
    codeBlock: `indexClient.listenIndexUpdates({
  sources: [
    "did:pkh:eip155:1:0x1b9Aceb609a62bae0c0a9682A9268138Faff4F5f",
    index.id
  ],
  query: "When something new happens about quantum computing",
  onMessage(event) {
    console.log("New event received:", event);
  }
});`,
  },
];

export default data;
