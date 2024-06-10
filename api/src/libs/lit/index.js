import { ethers } from "ethers";
import u8a from "@lit-protocol/uint8arrays";
import elliptic from "elliptic";
const ec = new elliptic.ec("secp256k1");
import { resolveProperties } from "@ethersproject/properties";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import * as LitJsSdk from "@lit-protocol/lit-node-client-nodejs";
import RedisClient from "../../clients/redis.js";
import { getAuthSigFromDIDSession } from "../../utils/helpers.js";
import { Cacao } from "@didtools/cacao";
import { AuthMethodType } from "@lit-protocol/constants";
import { randomBytes, randomString } from "@stablelib/random";
import { DIDSession, createDIDCacao } from "did-session";
import { DID } from "dids";
import { Ed25519Provider } from "key-did-provider-ed25519";
import { getResolver } from "key-did-resolver";
import { CID } from "multiformats/cid";
import { sendLit } from "./send_lit.js";

const provider = new ethers.providers.JsonRpcProvider(
  "https://chain-rpc.litprotocol.com/http",
  175177,
);

const config = {
  litNetwork: process.env.LIT_NETWORK,
  domain: process.env.DOMAIN,
};

const litNodeClient = new LitJsSdk.LitNodeClientNodeJs({
  litNetwork: config.litNetwork,
  debug: true,
  checkNodeAttestation: true,
});

const redis = RedisClient.getInstance();

class PKPSigner extends ethers.Signer {
  constructor(address, litNodeClient, rpcProvider, actionParams) {
    super(address);

    this.actionParams = actionParams;
    this.provider = rpcProvider;
    this.litNodeClient = litNodeClient;
    this.address = address;
  }

  async getAddress() {
    return this.address;
  }

  async signTransaction(transaction) {
    const addr = await this.getAddress();

    if (this.manualGasPrice) {
      transaction.gasPrice = this.manualGasPrice;
    }

    if (this.manualGasLimit) {
      transaction.gasLimit = this.manualGasLimit;
    }

    if (this.nonce) {
      transaction.nonce = this.nonce;
    }

    if (this.chainId) {
      transaction.chainId = this.chainId;
    }

    try {
      if (!transaction["gasLimit"]) {
        transaction.gasLimit = await this.provider.estimateGas(transaction);
      }

      if (!transaction["nonce"]) {
        transaction.nonce = await this.provider.getTransactionCount(addr);
      }

      if (!transaction["chainId"]) {
        transaction.chainId = (await this.provider.getNetwork()).chainId;
      }

      if (!transaction["gasPrice"]) {
        transaction.gasPrice = await this.getGasPrice();
      }
    } catch (err) {
      console.log(err);
    }

    return resolveProperties(transaction).then(async (tx) => {
      let params = this.actionParams;
      if (!litNodeClient.ready) {
        await litNodeClient.connect();
      }

      delete tx.from;
      const serializedTx = ethers.utils.serializeTransaction(tx);
      const unsignedTxn = ethers.utils.keccak256(serializedTx);

      //if(params.jsParams.signList[0].chain === "ethereum") {])
      if (params.jsParams.signList.signTransaction) {
        params.jsParams.signList.signTransaction.messageToSign =
          ethers.utils.arrayify(unsignedTxn);
      }
      /*
      if(params.jsParams.signList.getPKPSession){
        const didKeyBack = params.jsParams.signList.getPKPSession.didKey;
        params.jsParams.signList.getPKPSession.didKey = params.jsParams.signList.getPKPSession.didKey.id.toString();
      }
       */

      const resp = await this.litNodeClient.executeJs(params);

      if (!resp.signatures) {
        throw new Error("No signature returned");
      }
      /*
      if(resp.signatures.getPKPSession){

        const { siweMessage } = JSON.parse(resp.response.context);
        const sessionSignature = resp.signatures.getPKPSession; // TODO Handle.

        siweMessage.signature = ethers.utils.joinSignature({
          r: `0x${sessionSignature.r}`,
          s: `0x${sessionSignature.s}`,
          v: sessionSignature.recid,
        });

        const cacao = Cacao.fromSiweMessage(siweMessage);

        const did = await createDIDCacao(didKeyBack, cacao);
        const pkpSession = new DIDSession({ cacao, keySeed, did });

      }
      */

      if (resp.signatures.signTransaction) {
        const signature = resp.signatures.signTransaction.signature;
        return ethers.utils.serializeTransaction(tx, signature);
      }
    });
  }

  async sendTransaction(transaction) {
    const signedTransaction = await this.signTransaction(transaction);
    return this.provider.sendTransaction(signedTransaction);
  }
}

const signer = new ethers.Wallet(
  process.env.INDEXER_WALLET_PRIVATE_KEY,
  provider,
);

const litContracts = new LitContracts({
  network: config.litNetwork,
  signer: signer,
  debug: false,
});

export const writeAuthMethods = async ({
  userAuthSig,
  signerPublicKey,
  prevCID,
  newCID,
}) => {
  try {
    const dAppSessionSigsResponse = await redis.get(
      `lit:${config.litNetwork}:dAppSessionSigs`,
    );
    if (!dAppSessionSigsResponse) {
      throw new Error("No session signatures found");
    }
    const dAppSessionSigs = JSON.parse(dAppSessionSigsResponse);
    const signerFunctionV0 = CID.parse(prevCID).toV0().toString();

    if (!litNodeClient.ready) {
      await litNodeClient.connect();
    }
    const from = ethers.utils.computeAddress(signerPublicKey).toLowerCase();

    const keySeed = randomBytes(32);
    const didProvider = new Ed25519Provider(keySeed);
    // @ts-ignore
    const didKey = new DID({ provider: didProvider, resolver: getResolver() });
    await didKey.authenticate();

    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const twentyFiveDaysLater = new Date(
      now.getTime() + 25 * 24 * 60 * 60 * 1e3,
    );

    const signer = new PKPSigner(from, litNodeClient, provider, {
      ipfsId: signerFunctionV0,
      sessionSigs: dAppSessionSigs, // index app, which capacity credit, authorizes to pkp, not the user.
      jsParams: {
        userAuthSig: userAuthSig, // for conditions control. to identify authenticated user.
        publicKey: signerPublicKey,
        chain: "ethereum", // polygon
        nonce: randomString(12),
        currentDateTime: currentDateTime.toISOString(),
        twentyFiveDaysLater: twentyFiveDaysLater.toISOString(),
        signList: {
          signTransaction: {},
        },
      },
    });

    const litContracts = new LitContracts({
      network: config.litNetwork,
      signer: signer,
      debug: false,
    });

    if (!litContracts.connected) {
      await litContracts.connect();
    }

    const prevCIDV0 = CID.parse(prevCID).toV0().toString();
    const pubKeyHash = ethers.utils.keccak256(signerPublicKey);
    const tokenId = BigInt(pubKeyHash);
    const newCollabAction = litContracts.utils.getBytesFromMultihash(newCID);
    const previousCollabAction =
      litContracts.utils.getBytesFromMultihash(prevCIDV0);

    const transaction =
      await litContracts.pkpPermissionsContract.write.batchAddRemoveAuthMethods(
        tokenId,
        [2],
        [newCollabAction],
        ["0x"],
        [[BigInt(1)]],
        [2],
        [previousCollabAction],
      );

    //await transaction.wait()

    console.log("broadcast txn result:", JSON.stringify(transaction));
    return true;
  } catch (error) {
    console.error(error);
    throw new Error("Error writing auth methods");
  }
};

export const transferOwnership = async ({
  userAuthSig,
  signerPublicKey,
  signerFunction,
  previousOwner,
  newOwner,
}) => {
  try {
    const dAppSessionSigsResponse = await redis.get(
      `lit:${config.litNetwork}:dAppSessionSigs`,
    );
    if (!dAppSessionSigsResponse) {
      throw new Error("No session signatures found");
    }
    const dAppSessionSigs = JSON.parse(dAppSessionSigsResponse);
    const signerFunctionV0 = CID.parse(signerFunction).toV0().toString();

    if (!litNodeClient.ready) {
      await litNodeClient.connect();
    }
    const from = ethers.utils.computeAddress(signerPublicKey).toLowerCase();

    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const twentyFiveDaysLater = new Date(
      now.getTime() + 25 * 24 * 60 * 60 * 1e3,
    );

    const signer = new PKPSigner(from, litNodeClient, provider, {
      ipfsId: signerFunctionV0,
      sessionSigs: dAppSessionSigs, // index app, which capacity credit, authorizes to pkp, not the user.
      jsParams: {
        userAuthSig: userAuthSig, // for conditions control. to identify authenticated user.
        publicKey: signerPublicKey,
        chain: "ethereum", // polygon
        nonce: randomString(12),
        currentDateTime: now.toISOString(),
        twentyFiveDaysLater: twentyFiveDaysLater.toISOString(),
        signList: {
          signTransaction: {},
        },
      },
    });

    const subContract = new LitContracts({
      network: config.litNetwork,
      signer: signer,
      debug: false,
    });

    if (!subContract.connected) {
      await subContract.connect();
    }

    const pubKeyHash = ethers.utils.keccak256(signerPublicKey);
    const tokenId = BigInt(pubKeyHash);

    const transaction =
      await subContract.pkpPermissionsContract.write.batchAddRemoveAuthMethods(
        tokenId,
        [1],
        [newOwner],
        ["0x"],
        [[BigInt(1)]],
        [1],
        [previousOwner],
      );

    const res = await transaction.wait(1);

    console.log("broadcast txn result:", JSON.stringify(transaction));
    if (res) {
      return true;
    }
    return false;
  } catch (error) {
    console.error(error);
    throw new Error("Error writing auth methods");
  }
};

export const getLitOwner = async (pkpPubKey) => {
  let existing = await redis.hGet(`pkp:owner`, pkpPubKey);
  if (existing) {
    return existing;
  }

  const pubKeyHash = ethers.utils.keccak256(pkpPubKey);
  const pkpAddress = ethers.utils.computeAddress(pkpPubKey).toLowerCase();
  const tokenId = BigInt(pubKeyHash);

  if (!litContracts.connected) {
    await litContracts.connect();
  }

  const addressList =
    await litContracts.pkpPermissionsContractUtils.read.getPermittedAddresses(
      tokenId,
    );
  const address = addressList.filter(
    (a) => a.toLowerCase() !== pkpAddress.toLowerCase(),
  )[0];

  await redis.hSet(`pkp:owner`, pkpPubKey, address);

  return address;
};

export const encodeDIDWithLit = (pkpPubKey) => {
  pkpPubKey = pkpPubKey.replace("0x", "");

  const pubBytes = ec.keyFromPublic(pkpPubKey, "hex").getPublic(true, "array");

  const bytes = new Uint8Array(pubBytes.length + 2);

  bytes[0] = 0xe7;
  bytes[1] = 0x01;
  bytes.set(pubBytes, 2);

  const did = `did:key:z${u8a.uint8arrayToString(bytes, "base58btc")}`;

  return did;
};
export const decodeDIDWithLit = (encodedDID) => {
  const arr = encodedDID?.split(":");

  if (arr[0] != "did") throw Error("string should start with did:");
  if (arr[1] != "key") throw Error("string should start with did:key");
  if (arr[2].charAt(0) !== "z")
    throw Error("string should start with did:key:z");

  const str = arr[2].substring(1);

  const bytes = u8a.uint8arrayFromString(str, "base58btc");

  const originalBytes = new Uint8Array(bytes.length - 2);

  bytes.forEach((_, i) => {
    originalBytes[i] = bytes[i + 2];
  });

  const pubPoint = ec.keyFromPublic(originalBytes).getPublic();
  let pubKey = pubPoint.encode("hex", false);
  pubKey = pubKey.charAt(0) == "0" ? pubKey.substring(1) : pubKey;

  return "0x0" + pubKey;
};
export const walletToDID = (chain, wallet) =>
  `did:pkh:eip155:${parseInt(chain).toString()}:${wallet}`;

export const mintPKP = async (ownerAddress, actionCID) => {
  try {
    if (!litContracts.connected) {
      await litContracts.connect();
    }

    const signerFunctionV0 = CID.parse(actionCID).toV0().toString();
    const acid = litContracts.utils.getBytesFromMultihash(signerFunctionV0);

    const mintCost = await litContracts.pkpNftContract.read.mintCost();
    console.log(mintCost, `mintcost`);
    const mint =
      await litContracts.pkpHelperContract.write.mintNextAndAddAuthMethods(
        2,
        [AuthMethodType.EthWallet, AuthMethodType.LitAction],
        [ownerAddress.toLowerCase(), acid],
        ["0x", "0x"],
        [[BigInt(1)], [BigInt(1)]],
        true,
        true,
        {
          value: mintCost,
        },
      );
    const wait = await mint.wait(1);
    console.log(wait);
    /* eslint-disable */
    const tokenIdFromEvent = wait?.logs
      ? wait.logs[0].topics[1]
      : wait?.logs[0].topics[1];
    const tokenIdNumber = BigInt(tokenIdFromEvent).toString();
    const pkpPublicKey =
      await litContracts.pkpNftContract.read.getPubkey(tokenIdFromEvent);

    const pubKeyToAddr = await import("ethereum-public-key-to-address");
    sendLit(pubKeyToAddr.default(pkpPublicKey), "0.0001"); //Run in the background

    console.log("Minted and loaded!");

    console.log(
      `superlog, PKP public key is ${pkpPublicKey} and Token ID is ${tokenIdFromEvent} and Token ID number is ${tokenIdNumber}`,
    );

    return {
      tokenIdFromEvent,
      tokenIdNumber,
      pkpPublicKey,
    };
  } catch (e) {
    console.log(e);
  }
};

const delay = async (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
const sessionConcurrencyLimit = async (
  sessionCacheKey,
  retriesLeft = 20,
  interval = 3000,
  expirationTime = 100,
) => {
  // Base case: stop retrying if no retries are left
  if (retriesLeft <= 0) {
    console.log("Concurrency limit: no more retries and free to go now");
    await redis.del(`sessions:ops:${sessionCacheKey}`);
    return;
  }

  const sessionStr = await redis.hGet("sessions", sessionCacheKey);

  if (sessionStr) {
    console.log(
      `Concurrency limit: ${sessionCacheKey} is ready. No need anymore`,
    );
    return;
  }
  // Attempt to acquire a lock by using GETSET
  const previousValue = await redis.getSet(
    `sessions:ops:${sessionCacheKey}`,
    "1",
  );
  console.log("Concurrency limit: previousValue", previousValue);

  // If the key already had a value (previousValue is not null), retry after the specified interval
  if (previousValue !== null) {
    console.log("Concurrency limit: already processing, retrying later");
    await delay(interval);
    await sessionConcurrencyLimit(
      sessionCacheKey,
      retriesLeft - 1,
      interval,
      expirationTime,
    );
  } else {
    // If the key was empty, set expiration and continue
    console.log("Concurrency limit: is free to process new session");
    await redis.expire(`sessions:ops:${sessionCacheKey}`, expirationTime); // Expiry time in seconds
    return `Success: ${sessionCacheKey} is ready.`;
  }
};

const fetchAndAuthenticateSession = async (key) => {
  try {
    const sessionStr = await redis.hGet("sessions", key);
    if (sessionStr) {
      const didSession = await DIDSession.fromSession(sessionStr);
      await didSession.did.authenticate();
      return didSession;
    }
  } catch (error) {
    console.warn(error); // Log the error for visibility
    await redis.hDel("sessions", key); // Remove invalid/expired session
  }
  return null; // Return null if session is missing or couldn't authenticate
};

export const getPKPSession = async (session, index) => {
  await redis.hSet(`sessions`, index.id, session.serialize());
  return session;
};

export const getPKPSessionWithLIT = async (session, index) => {
  if (!session.did.authenticated) {
    throw new Error("Unauthenticated DID");
  }
  const owner = await getLitOwner(index.signerPublicKey);

  let sessionCacheKey = false;

  if (index.id && index.signerFunction) {
    sessionCacheKey = `${session.did.parent}:${owner}:${index.id}:${index.signerFunction}`;
  }

  if (sessionCacheKey) {
    let didSession = await fetchAndAuthenticateSession(sessionCacheKey);
    if (!didSession) {
      // Apply concurrency limit and retry fetching the session
      await sessionConcurrencyLimit(sessionCacheKey, 20, 3000);
      didSession = await fetchAndAuthenticateSession(sessionCacheKey);
    }

    if (didSession) {
      return didSession;
    }
  }

  const userAuthSig = getAuthSigFromDIDSession(session);

  const keySeed = randomBytes(32);
  const didProvider = new Ed25519Provider(keySeed);
  // @ts-ignore
  const didKey = new DID({ provider: didProvider, resolver: getResolver() });
  await didKey.authenticate();

  try {
    const dAppSessionSigsResponse = await redis.get(
      `lit:${config.litNetwork}:dAppSessionSigs`,
    );
    if (!dAppSessionSigsResponse) {
      throw new Error("No session signatures found");
    }
    const dAppSessionSigs = JSON.parse(dAppSessionSigsResponse);

    const signerFunctionV0 = CID.parse(index.signerFunction).toV0().toString();

    if (!litNodeClient.ready) {
      await litNodeClient.connect();
    }

    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const twentyFiveDaysLater = new Date(
      now.getTime() + 25 * 24 * 60 * 60 * 1e3,
    );

    const resp = await litNodeClient.executeJs({
      ipfsId: signerFunctionV0,
      sessionSigs: dAppSessionSigs, // index app, which capacity credit, authorizes to pkp, not the user.
      jsParams: {
        userAuthSig: userAuthSig, // for conditions control. to identify authenticated user.
        publicKey: index.signerPublicKey,
        nonce: randomString(12),
        currentDateTime: now.toISOString(),
        twentyFiveDaysLater: twentyFiveDaysLater.toISOString(),
        chain: "ethereum", // polygon
        signList: {
          getPKPSession: {
            didKey: didKey.id,
            domain: config.domain,
          },
        },
      },
    });

    if (!resp.signatures || !resp.signatures.getPKPSession) {
      throw new Error("No signature returned");
    }

    const { siweMessage } = JSON.parse(resp.response.context);
    const signature = resp.signatures.getPKPSession; // TODO Handle.

    siweMessage.signature = ethers.utils.joinSignature({
      r: `0x${signature.r}`,
      s: `0x${signature.s}`,
      v: signature.recid,
    });

    const cacao = Cacao.fromSiweMessage(siweMessage);

    const did = await createDIDCacao(didKey, cacao);
    const pkpSession = new DIDSession({ cacao, keySeed, did });

    if (sessionCacheKey) {
      await redis.hSet("sessions", sessionCacheKey, pkpSession.serialize());
      await redis.del(`sessions:ops:${sessionCacheKey}`);
    }

    await pkpSession.did.authenticate();
    return pkpSession;
  } catch (e) {
    await redis.del(`sessions:ops:${sessionCacheKey}`);
    console.log("Error", e);
  }
};

export const getRolesFromSession = (index, session, definition) => {
  if (
    session.cacao.p.resources.indexOf("ceramic://*") > -1 &&
    index.controllerDID.id == session.did.parent
  ) {
    return {
      owner: true,
      creator: false,
    };
  }
  return {
    owner: false,
    creator: false,
  };
};
