import { LitContracts } from "@lit-protocol/contracts-sdk";
import * as u8a from "uint8arrays";
import { keccak256 } from "@ethersproject/keccak256";
import { ec as EC } from "elliptic";

const ec = new EC("secp256k1");

export const getPkpPublicKey = async (tokenId: number): Promise<string> => {
	const litContracts = new LitContracts();
	await litContracts.connect();
	return await litContracts.pkpNftContract.read.getPubkey(tokenId);
};

export const getOwner = async (pkpPubKey: string): Promise<string> => {
	const pubkeyHash = keccak256(pkpPubKey);
	const tokenId = BigInt(pubkeyHash);
	const litContracts = new LitContracts();
	await litContracts.connect();
	return await litContracts.pkpNftContract.read.ownerOf(tokenId);
};

export const encodeDIDWithLit = (pkpPubKey: string): string => {
	pkpPubKey = pkpPubKey.replace("0x", "");

	const pubBytes = ec
		.keyFromPublic(pkpPubKey, "hex")
		.getPublic(true, "array");

	const bytes = new Uint8Array(pubBytes.length + 2);

	bytes[0] = 0xe7;
	bytes[1] = 0x01;
	bytes.set(pubBytes, 2);

	return `did:key:z${u8a.toString(bytes, "base58btc")}`;
};

export const decodeDIDWithLit = (encodedDID: string): string => {
	if (!encodedDID) throw new Error("Invalid argument: encodedDID is missing.");

	const arr = encodedDID.split(":");

	if (arr[0] !== "did") throw new Error("Invalid format: string should start with \"did:\"");
	if (arr[1] !== "key") throw new Error("Invalid format: string should start with \"did:key\"");
	if (arr[2].charAt(0) !== "z") throw new Error("Invalid format: string should start with \"did:key:z\"");

	const str = arr[2].substring(1);

	const bytes = u8a.fromString(str, "base58btc");

	const originalBytes = new Uint8Array(bytes.length - 2);

	bytes.forEach((_: any, i: any) => {
		originalBytes[i] = bytes[i + 2];
	});

	const pubPoint = ec.keyFromPublic(originalBytes).getPublic();
	const pubKey = pubPoint.encode("hex", false);
	// pubKey = pubKey.charAt(0) === "0" ? pubKey.substring(1) : pubKey;

	return `0x${pubKey}`;
};

export const walletToDID = (chain: number, wallet: string): string => `did:pkh:eip155:${parseInt(chain.toString())}:${wallet}`;
