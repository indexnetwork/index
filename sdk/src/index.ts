import { Cacao, SiweMessage } from "@didtools/cacao";
import { randomBytes } from "crypto";
import { DIDSession, createDIDCacao, createDIDKey } from "did-session";
import { Wallet } from "ethers";
import { CID } from "multiformats";

type ApiResponse<T> = Promise<T>;

function randomString(length: number) {
  var result = "";
  var characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

interface IIndex {
  id: string;
  title: string;
  signerFunction: string;
  signerPublicKey: string;
  did: {
    owned: boolean;
    starred: boolean;
  };
  roles: {
    owner: boolean;
    creator: boolean;
  };
  ownerDID: IUser;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  links: ILink[];
}

interface IUser {
  id: string;
  name?: string;
  bio?: string;
  avatar?: CID; // Assuming CID is correctly imported from 'multiformats'
  createdAt?: string;
  updatedAt?: string;
}

interface ILink {
  id: string;
  indexId?: string;
  indexerDID?: string;
  content?: string;
  title?: string;
  url?: string;
  description?: string;
  language?: string;
  favicon?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  images?: string[];
  favorite?: boolean;
  tags?: string[];
}

interface ILitActionConditions {
  chain: string;
  method: string;
  standardContractType: string;
  contractAddress: string;
  conditionType: string;
  parameters: string[];
  returnValueTest: object;
}

interface ICreatorAction {
  cid: string;
}

interface IGetItemQueryParams {
  limit?: number;
  cursor?: string;
  query?: string;
}

interface IUserProfileUpdateParams {
  name?: string;
  bio?: string;
  avatar?: string;
}

export default class IndexClient {
  private baseUrl: string;
  private session?: string;
  private network?: string;

  constructor(network?: string) {
    this.baseUrl = "https://dev.index.network/api";
    this.network = network || "ethereum";
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

  public async authenticate({
    session,
    domain,
  }: {
    session?: string;
    domain: string;
  }): Promise<void> {
    if (session) {
      this.session = session;
      return;
    }

    // Generate Ethereum Wallet: Create a new Ethereum wallet and retrieve its address.
    const wallet = Wallet.createRandom();
    const address = wallet.address;

    // DID Key Generation: Develop a DID key using a random seed
    const keySeed = randomBytes(32);
    const didKey = await createDIDKey(keySeed);

    const now = new Date();
    const threeMonthsLater = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    // Create a SIWE message for authentication.
    const siweMessage = new SiweMessage({
      domain,
      address,
      statement: "Give this application access to some of your data on Ceramic",
      uri: didKey.id,
      version: "1",
      chainId: "1",
      nonce: randomString(10),
      issuedAt: now.toISOString(),
      expirationTime: threeMonthsLater.toISOString(),
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

  public createIndex(
    title: string,
    signerPublicKey: string,
    signerFunction: string,
  ): ApiResponse<IIndex> {
    const body = { title, signerPublicKey, signerFunction };
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
}
