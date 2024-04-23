import { Cacao, SiweMessage } from "@didtools/cacao";
import { OpenAIEmbeddings } from "@langchain/openai";
import { randomBytes } from "crypto";
import { DIDSession, createDIDCacao, createDIDKey } from "did-session";
import { JsonRpcProvider, Wallet } from "ethers";
import IndexConfig from "./config.js";
import { Message } from "./types.js";

import IndexVectorStore from "./lib/chroma.js";
import {
  ICreatorAction,
  IGetItemQueryParams,
  IIndex,
  ILink,
  ILitActionConditions,
  IUser,
  IUserProfileUpdateParams,
} from "./types.js";
import { randomString } from "./util.js";

type ApiResponse<T> = Promise<T>;

export default class IndexClient {
  private baseUrl: string;
  private session?: string;
  private network?: string;
  private privateKey?: string;
  private domain: string;
  private chroma: any;
  private options?: { useChroma: boolean };

  constructor({
    domain,
    session,
    privateKey,
    network,
    options,
  }: {
    domain: string;
    session?: string;
    privateKey?: string;
    network?: string;
    options?: { useChroma: boolean };
  }) {
    this.baseUrl = IndexConfig.apiURL;
    this.network = network || "ethereum";
    this.domain = domain;
    if (session) {
      this.session = session;
    } else {
      this.privateKey = privateKey;
    }
  }

  private async initChroma() {
    if (!this.session) {
      throw new Error("Session is required to initialize Chroma");
    }
  }

  private async getVectorStore({
    embeddings,
    args,
  }: {
    embeddings: OpenAIEmbeddings;
    args: any;
  }) {
    return IndexVectorStore.fromExistingCollection(embeddings, {
      collectionName: "chroma-indexer",
      url: IndexConfig.indexChromaURL,
      ...args,
    });
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit,
  ): ApiResponse<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.session}`,
        ...options.headers,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`API call failed with status: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  public async authenticate(): Promise<void> {
    if (this.session) return;

    if (!this.privateKey || !this.domain) {
      throw new Error("Private key and domain is required to authenticate");
    }

    const wallet = new Wallet(
      this.privateKey,
      new JsonRpcProvider(IndexConfig.litProtocolRPCProviderURL),
    );
    const address = wallet.address;

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

    const signature = await wallet.signMessage(siweMessage.toMessage());

    siweMessage.signature = signature;

    const cacao = Cacao.fromSiweMessage(siweMessage);
    const did = await createDIDCacao(didKey, cacao);
    const newSession = new DIDSession({ cacao, keySeed, did });

    const authBearer = newSession.serialize();

    this.session = authBearer;

    this.initChroma();
  }

  public async *chat({
    id,
    indexes,
    did,
    messages,
  }: {
    id: string;
    indexes: string[];
    did?: string;
    messages: Message[];
  }): AsyncGenerator<string, void, undefined> {
    const response = await fetch(`${this.baseUrl}/discovery/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        id,
        indexIds: indexes,
        did,
      }),
    });

    if (!response.ok || response.body === null) {
      throw new Error("Error streaming messages");
    }

    const reader = response.body.getReader();
    let decoder = new TextDecoder("utf-8");

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        yield chunk;
      }
    } finally {
      reader.releaseLock();
    }
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

  public async getLitActions(cid: string): ApiResponse<ILitActionConditions[]> {
    return this.request(`/lit_actions/${cid}`, { method: "GET" });
  }

  public async postLitAction(
    action: ILitActionConditions,
  ): ApiResponse<ICreatorAction> {
    return this.request(`/lit_actions`, {
      method: "POST",
      body: JSON.stringify(action),
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

  public async createIndex(title: string): ApiResponse<IIndex> {
    const body = {
      title,
      signerFunction: IndexConfig.defaultCID,
    };

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

  public async getNFTMetadata(
    network: string,
    address: string,
    tokenId?: string,
  ): ApiResponse<any> {
    let endpoint = `/nft/${network}/${address}`;
    if (tokenId) {
      endpoint += `/${tokenId}`;
    }
    return this.request(endpoint, { method: "GET" });
  }

  public async resolveENS(ensName: string): ApiResponse<any> {
    return this.request(`/ens/${ensName}`, { method: "GET" });
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
}
