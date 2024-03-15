// import crypto from "crypto";

import { Wallet } from "ethers";
import { Cacao, SiweMessage } from "@didtools/cacao";
// import { randomString } from "@stablelib/random";
import { DIDSession, createDIDKey, createDIDCacao } from "did-session";

type ApiResponse<T> = Promise<T>;

function randomBytes(length: number) {
  var result = new Uint8Array(length);
  for (var i = 0; i < length; i++) {
    result[i] = Math.floor(Math.random() * 256);
  }
  return result;
}

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
  // Define properties
}

interface IUsers {
  // Define properties
}

// interface ILink {
//   // Define properties
// }

// interface ILitActionConditions {
//   // Define properties
// }

// interface ICreatorAction {
//   cid: string;
// }

// interface IGetItemQueryParams {
//   limit?: number;
//   cursor?: string;
//   query?: string;
// }

interface IUserProfileUpdateParams {
  name?: string;
  bio?: string;
  avatar?: string; // Using string type for CID for simplicity
}

export default class IndexClient {
  private baseUrl: string;
  private session?: string;
  private network?: string;

  constructor(network?: string) {
    this.baseUrl = "https://dev.index.network/api";
    this.network = network || "ethereum";
  }

  private async fetchFromApi<T>(
    endpoint: string,
    options: RequestInit,
  ): ApiResponse<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.session}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`API call failed with status: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  public async authenticate(session?: string): Promise<void> {
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
      domain: window.location.host,
      address: address,
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

    // siweMessage.signature = await ethProvider.request({
    //   method: "personal_sign",
    //   params: [siweMessage.signMessage(), getAddress(accountId.address)],
    // });
    //
    siweMessage.signature = signature;

    // Create a new session using the CACAO, key seed, and DID.
    const cacao = Cacao.fromSiweMessage(siweMessage);
    const did = await createDIDCacao(didKey, cacao);
    const newSession = new DIDSession({ cacao, keySeed, did });

    // Here is our authorization token.
    const authBearer = newSession.serialize();

    this.session = authBearer;
  }

  // GET /dids/:did/indexes
  public getAllIndexes(did: string): ApiResponse<IIndex[]> {
    return this.fetchFromApi(`/dids/${did}/indexes`, { method: "GET" });
  }

  // GET /dids/:did/profile
  public getProfile(did: string): ApiResponse<IUsers> {
    return this.fetchFromApi(`/dids/${did}/profile`, { method: "GET" });
  }

  public async getIndex(indexId: string): Promise<IIndex> {
    return this.fetchFromApi(`/indexes/${indexId}`, { method: "GET" });
  }

  public updateProfile(params: IUserProfileUpdateParams): ApiResponse<IUsers> {
    return this.fetchFromApi(`/profile`, {
      method: "PATCH",
      body: JSON.stringify(params),
    });
  }

  public async updateIndex(
    id: string,
    index: Partial<IIndex>,
  ): Promise<IIndex> {
    return this.fetchFromApi(`/indexes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(index),
    });
  }

  public createIndex(
    title: string,
    signerPublicKey: string,
    signerFunction: string,
  ): ApiResponse<IIndex> {
    const body = { title, signerPublicKey, signerFunction };
    return this.fetchFromApi(`/indexes`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}
