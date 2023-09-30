import { LitContracts } from "@lit-protocol/contracts-sdk";
import u8a from '@lit-protocol/uint8arrays';
import { keccak256 } from "@ethersproject/keccak256";
import { ethers } from "ethers";
import elliptic from "elliptic";
const ec = new elliptic.ec("secp256k1");

import RedisClient from '../../clients/redis.js';
const redis = RedisClient.getInstance();


export const getPkpPublicKey = async (tokenId) => {
	const litContracts = new LitContracts();
	await litContracts.connect();
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

	const litContracts = new LitContracts();
	await litContracts.connect();

	const address = await litContracts.pkpNftContract.read.ownerOf(tokenId);
	await redis.hSet(`pkp:owner`, pkpPubKey, address);

    return address;
}

export const getOwnerProfile = async (pkpPubKey) => {
	const owner = await getOwner(pkpPubKey);
	const profile = await redis.hGet(`profiles`, `did:pkh:eip155:175177:${owner}`)
	if(profile){
		return JSON.parse(profile);
	}else{
		return { id: `did:pkh:eip155:175177:${owner}` }
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
