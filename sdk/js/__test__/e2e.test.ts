import { Wallet } from "ethers";
import IndexClient from "../dist/indexclient.cjs";
import { OpenAIEmbeddings } from "@langchain/openai";
import { randomBytes } from "crypto";

describe("IndexClient E2E Tests", () => {
  let client;
  const testDomain = "test.domain";
  const did = "did:pkh:eip155:1:0xB1dB8147c6b5dE15D762566C83a0c6be87481A7e";
  const testPrivateKey =
    "0x4a4815e4913effa3eab8e99a012137d29e9487700f7c0bdf08c8ce0eafe00553";
  const testWallet = new Wallet(testPrivateKey);

  beforeAll(async () => {
    client = new IndexClient({
      domain: testDomain,
      wallet: testWallet,
      network: "dev",
      options: { useChroma: true },
    });

    await client.authenticate();
  });

  it("should authenticate the user", async () => {
    expect(client["session"]).toBeTruthy();
  });

  it("should star and unstar an index", async () => {
    const indexTitle = "Test Index for Starring";
    const index = await client.createIndex(indexTitle);

    await client.starIndex(did, index.id);

    const starredIndex = await client.getIndex(index.id);
    expect(starredIndex.did.starred).toBeTruthy();

    await client.unstarIndex(did, index.id);
    const unstarredIndex = await client.getIndex(index.id);
    expect(unstarredIndex.did.starred).toBeFalsy();
  });

  it("should own and disown an index", async () => {
    const indexTitle = "Test Index for Owning";
    const index = await client.createIndex(indexTitle);

    await client.ownIndex(did, index.id);
    const ownedIndex = await client.getIndex(index.id);

    expect(ownedIndex.did.owned).toBeTruthy();

    await client.disownIndex(did, index.id);
    const disownedIndex = await client.getIndex(index.id);

    expect(disownedIndex.did.owned).toBeFalsy();
  });

  it("should get user profile", async () => {
    const did = "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7";
    const profile = await client.getProfile(did);
    expect(profile.id).toEqual(did);
  });

  it("should create and retrieve an index", async () => {
    const indexTitle = "Test Index";
    const index = await client.createIndex(indexTitle);
    expect(index).toHaveProperty("title", indexTitle);

    const retrievedIndex = await client.getIndex(index.id);
    expect(retrievedIndex).toEqual(index);
  });

  it("should update user profile", async () => {
    const updateParams = {
      name: "New Name",
      bio: "New Bio",
    };
    const updatedProfile = await client.updateProfile(updateParams);
    expect(updatedProfile).toMatchObject(updateParams);
  });

  it("should create and delete an item in the index", async () => {
    const indexTitle = "Test Index for Item " + new Date().getTime();
    const index = await client.createIndex(indexTitle);

    const webNode = await client.crawlWebPage("https://index.network");
    const createdItem = await client.addItemToIndex(index.id, webNode.id);

    expect(webNode.id).toEqual(createdItem.node.id);

    await client.deleteItemFromIndex(index.id, webNode.id);

    const itemsResponse = await client.getItems(index.id, {});
    expect(itemsResponse.items).not.toContainEqual(createdItem);
  });

  it("should create, update, and delete a conversation", async () => {
    const conversationParams = {
      sources: [did],
    };
    const conversation = await client.createConversation(conversationParams);
    expect(conversation).toHaveProperty("sources", conversationParams.sources);

    const updateParams = {
      summary: `Conversation summary`,
      sources: [did],
    };
    const updatedConversation = await client.updateConversation(
      conversation.id,
      updateParams,
    );
    expect(updatedConversation.summary).toEqual(updateParams.summary);

    await client.deleteConversation(conversation.id);
    try {
      const resp = await client.getConversation(conversation.id);
      console.log(resp);
    } catch (error) {
      expect(error.message).toContain("404");
    }
  });

  it("should create, update, and delete a message in a conversation", async () => {
    const conversationParams = {
      sources: [did],
    };
    const conversation = await client.createConversation(conversationParams);

    const messageParams = {
      role: "user",
      content: "Test message content",
    };
    const message = await client.createMessage(conversation.id, messageParams);
    expect(message).toHaveProperty("content", messageParams.content);

    const updateParams = {
      content: "Updated test message content",
      role: "user",
    };
    const updatedMessage = await client.updateMessage(
      conversation.id,
      message.id,
      updateParams,
    );
    expect(updatedMessage).toMatchObject(updateParams);

    await client.deleteMessage(conversation.id, message.id);

    const convo = await client.getConversation(conversation.id);

    expect(convo.messages.filter((m) => m.id === message.id).length).toEqual(0);

    // Clean up conversation
    await client.deleteConversation(conversation.id);
  });

  afterAll(() => {
    // Clean up resources if needed
  });
});
