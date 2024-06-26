import { EventSource } from "cross-eventsource";

import { Cacao, SiweMessage } from "@didtools/cacao";
import { OpenAIEmbeddings } from "@langchain/openai";
import { DIDSession, createDIDCacao, createDIDKey } from "did-session";
import { Wallet, randomBytes } from "ethers";
import IndexConfig from "./config.js";
import IndexVectorStore from "./lib/chroma.js";
import {
  IGetItemQueryParams,
  IIndex,
  ILink,
  IUser,
  IUserProfileUpdateParams,
  ICreateConversationParams,
  ICreateMessageParams,
  IUpdateConversationParams,
  IUpdateMessageParams,
  Message,
} from "./types.js";
import { randomString } from "./util.js";

type ApiResponse<T> = Promise<T>;

type IndexNetworkType = "mainnet" | "dev";

export default class IndexClient {
  private baseUrl: string;
  private session?: string;
  private network?: IndexNetworkType;
  private wallet?: Wallet;
  private domain?: string;
  private chroma: any;
  private options?: { useChroma: boolean };

  constructor({
    domain,
    session,
    privateKey,
    wallet,
    network,
    options,
  }: {
    domain: string;
    session?: string;
    privateKey?: string;
    wallet?: Wallet;
    network?: IndexNetworkType;
    options?: { useChroma: boolean };
  }) {
    if (!domain) throw new Error("Domain is required");
    this.domain = domain;

    if (session) {
      this.session = session;
    } else if (privateKey) {
      this.wallet = new Wallet(privateKey);
    } else if (wallet) {
      this.wallet = wallet;
    } else {
      throw new Error("Either session or wallet (with privateKey) is required");
    }

    this.network = network || "dev";
    this.baseUrl =
      this.network === "mainnet"
        ? "https://index.network/api"
        : "https://dev.index.network/api";
    this.options = options;
  }

  private async initChroma() {
    if (!this.session) {
      throw new Error("Session is required to initialize Chroma");
    }
    // Chroma initialization logic (e.g., this.chroma = new Chroma(this.session))
  }

  public async getVectorStore({
    embeddings,
    sources,
    filters,
  }: {
    embeddings: OpenAIEmbeddings;
    sources: string[];
    filters: object;
  }) {
    let indexChromaURL =
      this.network === "mainnet"
        ? "https://index.network/api/chroma"
        : "https://dev.index.network/api/chroma";

    return IndexVectorStore.fromExistingCollection(embeddings, {
      collectionName: "chroma-indexer",
      url: indexChromaURL,
    });
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit,
  ): ApiResponse<T> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.session}`,
          ...options.headers,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `API call failed with status: ${response.status} - ${response.statusText}`,
        );
      }

      return response.json() as Promise<T>;
    } catch (error) {
      throw new Error(`Network error: ${error.message}`);
    }
  }

  public async authenticate(): Promise<void> {
    if (this.session) return;

    if (!this.wallet || !this.domain) {
      throw new Error("Wallet and domain are required to authenticate");
    }

    const address = this.wallet.address;
    const keySeed = randomBytes(32);
    const didKey = await createDIDKey(keySeed);

    const now = new Date();
    const oneMonthLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const siweMessage = new SiweMessage({
      domain: this.domain,
      address,
      statement: "Give this application access to some of your data on Ceramic",
      uri: didKey.id,
      version: "1",
      chainId: "1",
      nonce: randomString(10),
      issuedAt: now.toISOString(),
      expirationTime: oneMonthLater.toISOString(),
      resources: ["ceramic://*"],
    });

    const signature = await this.wallet.signMessage(siweMessage.toMessage());
    siweMessage.signature = signature;

    const cacao = Cacao.fromSiweMessage(siweMessage);
    const did = await createDIDCacao(didKey, cacao);
    const newSession = new DIDSession({ cacao, keySeed, did });
    const authBearer = newSession.serialize();

    this.session = authBearer;

    await this.initChroma();
  }

  public getAllIndexes(did: string): ApiResponse<IIndex[]> {
    return this.request(`/dids/${did}/indexes`, { method: "GET" });
  }

  public getProfile(did: string): ApiResponse<IUser> {
    return this.request(`/dids/${did}/profile`, { method: "GET" });
  }

  public async getIndex(indexId: string): Promise<IIndex> {
    return this.request(`/indexes/${indexId}`, { method: "GET" });
  }

  public updateProfile(params: IUserProfileUpdateParams): ApiResponse<IUser> {
    return this.request(`/profile`, {
      method: "PATCH",
      body: JSON.stringify(params),
    });
  }

  public async updateIndex(
    id: string,
    index: Partial<IIndex>,
  ): Promise<IIndex> {
    return this.request(`/indexes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(index),
    });
  }

  public async crawlWebPage(url: string): ApiResponse<ILink> {
    return this.request(`/web2/webpage/crawl`, {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }

  public async getItems(
    indexId: string,
    queryParams: IGetItemQueryParams,
  ): ApiResponse<any[]> {
    const query = new URLSearchParams(queryParams as any).toString();
    return this.request(`/indexes/${indexId}/items?${query}`, {
      method: "GET",
    });
  }

  public async createIndex(
    title: string,
    signerFunction?: string,
  ): ApiResponse<IIndex> {
    const body = { title, signerFunction };
    return this.request(`/indexes`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  public async addItemToIndex(
    indexId: string,
    itemId: string,
  ): ApiResponse<any> {
    return this.request(`/indexes/${indexId}/items/${itemId}`, {
      method: "POST",
    });
  }

  public async deleteItemFromIndex(
    indexId: string,
    itemId: string,
  ): ApiResponse<any> {
    return this.request(`/indexes/${indexId}/items/${itemId}`, {
      method: "DELETE",
    });
  }

  public async getENSNameDetails(ensName: string): ApiResponse<any> {
    return this.request(`/ens/${ensName}`, {
      method: "GET",
    });
  }

  public async createItem(indexId: string, item: any): ApiResponse<any> {
    return this.request(`/indexes/${indexId}/items`, {
      method: "POST",
      body: JSON.stringify(item),
    });
  }

  public async deleteItem(indexId: string, itemId: string): ApiResponse<void> {
    return this.request(`/indexes/${indexId}/items/${itemId}`, {
      method: "DELETE",
    });
  }

  public async starIndex(did: string, indexId: string): ApiResponse<void> {
    return this.request(`/dids/${did}/indexes/${indexId}/star`, {
      method: "PUT",
    });
  }

  public async unstarIndex(did: string, indexId: string): ApiResponse<void> {
    return this.request(`/dids/${did}/indexes/${indexId}/star`, {
      method: "DELETE",
    });
  }

  public async ownIndex(did: string, indexId: string): ApiResponse<void> {
    return this.request(`/dids/${did}/indexes/${indexId}/own`, {
      method: "PUT",
    });
  }

  public async disownIndex(did: string, indexId: string): ApiResponse<void> {
    return this.request(`/dids/${did}/indexes/${indexId}/own`, {
      method: "DELETE",
    });
  }

  public async getNodeById(modelId: string, nodeId: string): ApiResponse<any> {
    return this.request(`/composedb/${modelId}/${nodeId}`, { method: "GET" });
  }

  public async createNode(modelId: string, nodeData: any): ApiResponse<any> {
    return this.request(`/composedb/${modelId}`, {
      method: "POST",
      body: JSON.stringify(nodeData),
    });
  }

  public async updateNode(
    modelId: string,
    nodeId: string,
    nodeData: any,
  ): ApiResponse<any> {
    return this.request(`/composedb/${modelId}/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(nodeData),
    });
  }

  public async getConversation(conversationId: string): ApiResponse<any> {
    return this.request(`/conversations/${conversationId}`, {
      method: "GET",
    });
  }

  public async createConversation(
    params: ICreateConversationParams,
  ): ApiResponse<any> {
    return this.request(`/conversations`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  public async updateConversation(
    conversationId: string,
    params: IUpdateConversationParams,
  ): ApiResponse<any> {
    return this.request(`/conversations/${conversationId}`, {
      method: "PUT",
      body: JSON.stringify(params),
    });
  }

  public async deleteConversation(conversationId: string): ApiResponse<void> {
    return this.request(`/conversations/${conversationId}`, {
      method: "DELETE",
    });
  }

  public async createMessage(
    conversationId: string,
    params: ICreateMessageParams,
  ): ApiResponse<any> {
    return this.request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  public listenToConversationUpdates(
    conversationId: string,
    handleMessage: (data: any) => void,
    handleError: (error: any) => void,
  ) {

    const eventUrl = `${this.baseUrl}/conversations/${conversationId}/updates?session=${this.session}`;
    const eventSource = new EventSource(eventUrl);

    eventSource.addEventListener("message", async (event) => {
      console.log("Received message from server", event);
      handleMessage(event);
    });

    eventSource.addEventListener("error", (error) => {
      console.error("EventSource failed:", error);
      handleError(error);
    });

    return () => {
      eventSource.close();
    };
  }

  public async updateMessage(
    conversationId: string,
    messageId: string,
    params: IUpdateMessageParams,
    deleteAfter?: boolean,
  ): ApiResponse<any> {
    const queryParams = deleteAfter ? `?deleteAfter=true` : "";
    return this.request(
      `/conversations/${conversationId}/messages/${messageId}${queryParams}`,
      {
        method: "PUT",
        body: JSON.stringify(params),
      },
    );
  }

  public async deleteMessage(
    conversationId: string,
    messageId: string,
    deleteAfter?: boolean,
  ): ApiResponse<void> {
    const queryParams = deleteAfter ? `?deleteAfter=true` : "";
    return this.request(
      `/conversations/${conversationId}/messages/${messageId}${queryParams}`,
      {
        method: "DELETE",
      },
    );
  }

  public listenToIndexUpdates(
    sources: string[],
    query: string,
    handleMessage: (data: any) => void,
    handleError: (error: any) => void,
  ) {
    const queryParams = new URLSearchParams();

    const params = { query, sources, session: this.session };
    for (const key in params) {
      if (params.hasOwnProperty(key)) {
        queryParams.append(key, params[key]);
      }
    }

    const eventUrl = `${this.baseUrl}/discovery/updates${queryParams.toString()}`;
    const eventSource = new EventSource(eventUrl);

    eventSource.addEventListener("message", async (event) => {
      console.log("Received message from server", event.data);
      handleMessage(event.data);
    });

    eventSource.addEventListener("error", (error) => {
      console.error("EventSource failed:", error);
      handleError(error);
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }
}

export { IndexVectorStore, IndexConfig };
