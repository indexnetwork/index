const { LitContracts } = require("@lit-protocol/contracts-sdk");
const u8a = require('@lit-protocol/uint8arrays')

const elliptic = require("elliptic");
const ec = new elliptic.ec("secp256k1");

exports.getPkpPublicKey = async (tokenId) => {
		const litContracts = new LitContracts();
		await litContracts.connect();
		const pkpPublicKey = await litContracts.pkpNftContract.read.getPubkey(tokenId);
		return pkpPublicKey
}

exports.encodeDIDWithLit = (pkpPubKey) =>  {

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

exports.walletToDID = (chain, wallet) => {
	return `did:pkh:eip155:${chain}:${wallet}`
}