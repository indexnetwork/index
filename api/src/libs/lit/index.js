import { keccak256 } from "@ethersproject/keccak256";
import u8a from '@lit-protocol/uint8arrays';
import elliptic from "elliptic";
import { ethers } from "ethers";
const ec = new elliptic.ec("secp256k1");

import { LitContracts } from '@lit-protocol/contracts-sdk';
import * as LitJsSdk from "@lit-protocol/lit-node-client-nodejs";
import RedisClient from '../../clients/redis.js';
import { DIDService } from "../../services/did.js";
import { getAuthSigFromDIDSession } from "../../utils/helpers.js";

import { definition } from "../../types/merged-runtime.js";

import { Cacao } from "@didtools/cacao";
import { AuthMethodType } from '@lit-protocol/constants';
import { PKPEthersWallet } from "@lit-protocol/pkp-ethers";
import { randomBytes, randomString } from "@stablelib/random";
import { DIDSession, createDIDCacao } from "did-session";
import { DID } from "dids";
import { Ed25519Provider } from "key-did-provider-ed25519";
import { getResolver } from "key-did-resolver";
import { CID } from 'multiformats/cid';
import { sendLit } from "./send_lit.js";

const config = {
	litNetwork: process.env.LIT_NETWORK,
	domain: process.env.DOMAIN,
};

const litContracts = new LitContracts({
    network: config.litNetwork,
    privateKey: process.env.INDEXER_WALLET_PRIVATE_KEY,
});

const litNodeClient = new LitJsSdk.LitNodeClientNodeJs({
	litNetwork: config.litNetwork,
	debug: !!process.env.DEBUG || false,
	checkNodeAttestation: false,
});
const redis = RedisClient.getInstance();

export const getPkpPublicKey = async (tokenId) => {
  if(!litContracts.connected){
    await litContracts.connect();
  }
	const pkpPublicKey = await litContracts.pkpNftContract.read.getPubkey(tokenId);
	return pkpPublicKey
}

export const getOwner = async (pkpPubKey) => {

	let existing = await redis.hGet(`pkp:owner`, pkpPubKey);
	if(existing){
		return existing;
	}

	const pubKeyHash = keccak256(pkpPubKey);
	const tokenId = BigInt(pubKeyHash);


  if(!litContracts.connected){
    await litContracts.connect();
  }

	const address = await litContracts.pkpNftContract.read.ownerOf(tokenId);
	await redis.hSet(`pkp:owner`, pkpPubKey, address);

    return address;
}

export const getOwnerProfile = async (id) => {

	const didService = new DIDService()

	const owner = await didService.getOwner(id);
	console.log(owner)
	if(owner && owner.controllerDID && owner.controllerDID.id){
	  return owner;
	}else{
	 return { id: `did:pkh:eip155:1:0` }
	}
}


export const encodeDIDWithLit = (pkpPubKey) =>  {

	pkpPubKey = pkpPubKey.replace('0x', '')

	const pubBytes = ec
	.keyFromPublic(pkpPubKey, "hex")
	.getPublic(true, "array");

	const bytes = new Uint8Array(pubBytes.length + 2);

	bytes[0] = 0xe7;
	bytes[1] = 0x01;
	bytes.set(pubBytes, 2);

	const did = `did:key:z${u8a.uint8arrayToString(bytes, "base58btc")}`;

	return did;
}


export const decodeDIDWithLit = (encodedDID) => {

    const arr = encodedDID?.split(':');

    if(arr[0] != 'did') throw Error('string should start with did:');
    if(arr[1] != 'key') throw Error('string should start with did:key');
    if(arr[2].charAt(0) !== 'z') throw Error('string should start with did:key:z');

    const str = arr[2].substring(1);;

    const bytes = u8a.uint8arrayFromString(str, "base58btc");

    const originalBytes = new Uint8Array(bytes.length - 2);

    bytes.forEach((_, i) => {
        originalBytes[i] = bytes[i + 2];
    });

    const pubPoint = ec.keyFromPublic(originalBytes).getPublic();
    let pubKey = pubPoint.encode('hex', false);
    pubKey = pubKey.charAt(0) == '0' ? pubKey.substring(1) : pubKey;

    return '0x0' + pubKey;
}

export const walletToDID = (chain, wallet) => `did:pkh:eip155:${parseInt(chain).toString()}:${wallet}`


export const getPKPSessionForIndexer = async(index) => {
  const indexerSession = await redis.get(`indexer:did:session`);
	if(!indexerSession) {
	  throw new Error("No session signatures found");
	}

  const session = await DIDSession.fromSession(indexerSession);
  await session.did.authenticate()

  const pkpSession =  await getPKPSession(session, index);
  console.log(pkpSession)
  return pkpSession;
}

export const writeAuthMethods = async ({ userAuthSig, signerPublicKey, prevCID, newCID}) => {

  try {

    const pkpWallet = new PKPEthersWallet({
      litNetwork: config.litNetwork,
      controllerAuthSig: userAuthSig,
      pkpPubKey: signerPublicKey,
      rpc: "https://chain-rpc.litprotocol.com/http",
    });
    await pkpWallet.init();

    const contractSigner = new LitContracts({
      network: config.litNetwork,
      signer: pkpWallet,
      debug: true
    });

    await contractSigner.connect();

    const prevCIDV0 = CID.parse(prevCID).toV0().toString();
    const pubKeyHash = ethers.keccak256(signerPublicKey);
    const tokenId = BigInt(pubKeyHash);
    const newCollabAction = contractSigner.utils.getBytesFromMultihash(newCID);
    const previousCollabAction =
      litContracts.utils.getBytesFromMultihash(prevCIDV0);

    const signed = await contractSigner.pkpPermissionsContract.write.batchAddRemoveAuthMethods(
      tokenId,
      [2],
      [newCollabAction],
      ["0x"],
      [[BigInt(1)]],
      [2],
      [previousCollabAction], {
        gasPrice: ethers.parseUnits("0.001", "gwei"),
        gasLimit: 400000
      }
    );
    console.log(signed, "Signed!")
  } catch (error) {
    console.error(error);
    throw new Error("Error writing auth methods");
  }
}
export const mintPKP = async (ownerAddress, actionCID) => {

  if(!litContracts.connected){
    await litContracts.connect();
  }

  const signerFunctionV0 = CID.parse(actionCID).toV0().toString();
  const acid = litContracts.utils.getBytesFromMultihash(signerFunctionV0);

  const mintCost = await litContracts.pkpNftContract.read.mintCost();
  const mint =
    (await litContracts.pkpHelperContract.write.mintNextAndAddAuthMethods(
      2,
      [AuthMethodType.EthWallet, AuthMethodType.LitAction],
      [ownerAddress, acid],
      ["0x", "0x"],
      [[BigInt(1)], [BigInt(1)]],
      true,
      true,
      {
        value: mintCost,
      },
    ));
  const wait = await mint.wait();

  /* eslint-disable */
  const tokenIdFromEvent = wait?.logs
    ? wait.logs[0].topics[1]
    : wait?.logs[0].topics[1];
  const tokenIdNumber = BigInt(tokenIdFromEvent).toString();
  const pkpPublicKey =
    await litContracts.pkpNftContract.read.getPubkey(tokenIdFromEvent);

  const pubKeyToAddr = await import('ethereum-public-key-to-address');
  sendLit(pubKeyToAddr.default(pkpPublicKey), "0.0001") //Run in the background

  console.log(mint, "Minted and loaded!");

  //
  /*
  const authMethods = await litContracts.pkpPermissionsContract.read.getPermittedAuthMethods(tokenIdFromEvent );

  console.log("lit.authMethods", authMethods[0])
  const scopes = await litContracts.pkpPermissionsContract.read.getPermittedAuthMethodScopes(
      tokenIdFromEvent,
      authMethods[0].authMethodType,
      authMethods[0].id,
      3
  );
  console.log("lit.scopes", scopes)
   */

  console.log(
    `superlog, PKP public key is ${pkpPublicKey} and Token ID is ${tokenIdFromEvent} and Token ID number is ${tokenIdNumber}`,
  );

  return {
    tokenIdFromEvent,
    tokenIdNumber,
    pkpPublicKey,
  };
}

export const getPKPSession = async (session, index) => {

	if(!session.did.authenticated){
		throw new Error("Unauthenticated DID");
	}

	let sessionCacheKey = false;

	if(index.id && index.signerFunction) {
	  sessionCacheKey = `${session.did.parent}:${index.id}:${index.signerFunction}`
	  const existingSessionStr = await redis.hGet("sessions", sessionCacheKey);
		if (existingSessionStr) {
			try {
				const didSession = await DIDSession.fromSession(existingSessionStr);
				await didSession.did.authenticate()
				return didSession;

			} catch (error) {
				//Expired or invalid session, remove cache.
				console.warn(error);
				await redis.hDel("sessions", sessionCacheKey);
			}
		}
  }

	const userAuthSig = getAuthSigFromDIDSession(session)

	const keySeed = randomBytes(32);
	const didProvider = new Ed25519Provider(keySeed);
	// @ts-ignore
	const didKey = new DID({ provider:didProvider, resolver: getResolver() });
	await didKey.authenticate();


	try {

	  const dAppSessionSigsResponse = await redis.get(`lit:${config.litNetwork}:dAppSessionSigs`);
		if(!dAppSessionSigsResponse) {
		  throw new Error("No session signatures found");
		}
		const dAppSessionSigs = JSON.parse(dAppSessionSigsResponse);

		const signerFunctionV0 = CID.parse(index.signerFunction).toV0().toString();

    if(!litNodeClient.ready){
      await litNodeClient.connect();
    }

		const resp = await litNodeClient.executeJs({
			ipfsId: signerFunctionV0,
			sessionSigs: dAppSessionSigs, // index app, which capacity credit, authorizes to pkp, not the user.
			jsParams: {
				authSig: userAuthSig, // for conditions control. to identify authenticated user.
				chain: "ethereum", // polygon
				publicKey: index.signerPublicKey,
				didKey: didKey.id,
				nonce: randomString(12),
				domain: config.domain,
				sigName: "sig1",
			},
		});

		const { error } = resp.response; // TODO Handle.
		if (error) {
			throw new Error("LIT Node Client Error")
		}

		if(!resp.signatures || !resp.signatures.sig1 ){
			throw new Error("No signature returned")
		}

		const { siweMessage } = JSON.parse(resp.response.context);
		const signature = resp.signatures.sig1; // TODO Handle.

		siweMessage.signature = ethers.Signature.from({
			r: `0x${signature.r}`,
			s: `0x${signature.s}`,
			v: signature.recid,
		}).serialized;

		const cacao = Cacao.fromSiweMessage(siweMessage);

		const did = await createDIDCacao(didKey, cacao);
		const pkpSession = new DIDSession({ cacao, keySeed, did });

		if(sessionCacheKey){
		  await redis.hSet("sessions", sessionCacheKey, pkpSession.serialize());
		}

		await pkpSession.did.authenticate()
		return pkpSession

	} catch (e){
		console.log("Error", e)
	}

}

export const getRolesFromSession = (session) => {
	const authorizedModels = new Set(session.cacao.p.resources.map(r => r.replace("ceramic://*?model=", "")));

	const owner = authorizedModels.has(definition.models.Index.id);

	const creator = authorizedModels.has(definition.models.IndexItem.id)
		&& authorizedModels.has(definition.models.Embedding.id);

	return {
		owner,
		creator,
	};
}
