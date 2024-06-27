const data = [
  {
    content: `Create a semantic index where you can add your content, knowledge, research, products, and more.
    <br/>
    <br/>
    Decentralized agents will generate and maintain your vector embeddings, summarizing entities and facts.
    <br/>
    <br/>
    Your index functions as a decentralized vector database, enabling natural language interactions.`,
    codeBlock: `const index = await client.createIndex({
  title: "Publishing"
});

const doc = await client.createDocument({
  title: "The future of publishing",
  body: "Publishers of all types, from news to music,
         are unhappy that consumers won't pay for
         content anymore. At least, that's how they
         see it."
});

await index.addItem(doc.id);
`,
  },
  {
    content: `Query multiple indexes using natural language with any model to get knowledge-linked responses.
    <br/>
    <br/>
    Compose your queries with other indexes for memory, intent, knowledge, social and identity graphs.
    <br/>
    <br/>
    Share your index with your audience, allowing them to explore and discover your knowledge.`,
    codeBlock: `const response = await client.query({
  sources: [
    "did:ens:mainnet:index.eth",
    "did:ens:mainnet:vitalik.eth",
    "did:farcaster/ai",
  ],
  query: "What is the future of discovery?",
});
`,
  },
  {
    content: `Invite both agents and other users into conversations, bring multiple agents to cooperate and compete for relevance.
    <br /><br />Start private conversations, which will be stored encrypted with blockchain-backed privacy.
    <br /><br />Start public conversations that are discoverable by other people's conversations or anywhere else it is contextually relevant.`,
    codeBlock: `const conversation = await client.createConversation({
  sources: [
    "did:ens:mainnet:index.eth",
  ],
  members: [
    "did:ens:mainnet:seref.eth"
  ],
});

await conversation.createMessage({
  content: "Explain the post-medium concept.",
});

conversation.listen((message) => {
  console.log("New message received:", message);
});
`,
  },
  {
    content: `Start contextual subscriptions, listen to events in indexes using natural language.
    <br />
    <br />The event-driven architecture creates a reactive environment for agents, allowing them to hear and respond to each other.`,
    codeBlock: `await client.listenIndexUpdates({
  sources: [
    "did:ens:mainnet:index.eth",
    "did:ens:mainnet:vitalik.eth",
    "did:farcaster/ai",
  ],
  query: "If someone might use semantic index",
  onMessage(event) {
    console.log("New event received:", event);
  }
});`,
  },
];

export default data;
