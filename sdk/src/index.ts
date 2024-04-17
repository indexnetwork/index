import { Cacao, SiweMessage } from "@didtools/cacao";
import { randomBytes } from "crypto";
import { DIDSession, createDIDCacao, createDIDKey } from "did-session";
import { JsonRpcProvider, Wallet } from "ethers";
import IndexConfig from "./config.js";
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

  constructor({
    domain,
    session,
    privateKey,
    network,
  }: {
    domain: string;
    session?: string;
    privateKey?: string;
    network?: string;
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

    // DID Key Generation: Develop a DID key using a random seed
    const keySeed = randomBytes(32);
    const didKey = await createDIDKey(keySeed);

    const now = new Date();
    const oneMonthLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Create a SIWE message for authentication.
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

    // Sign the SIWE message with the wallet's private key.
    const signature = await wallet.signMessage(siweMessage.toMessage());

    siweMessage.signature = signature;

    // Create a new session using the CACAO, key seed, and DID.
    const cacao = Cacao.fromSiweMessage(siweMessage);
    const did = await createDIDCacao(didKey, cacao);
    const newSession = new DIDSession({ cacao, keySeed, did });

    // Here is our authorization token.
    const authBearer = newSession.serialize();

    this.session = authBearer;
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

  public async crawlLink(url: string): ApiResponse<ILink> {
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
