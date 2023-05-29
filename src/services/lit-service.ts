import { ethers } from "ethers";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { Secp256k1ProviderWithLit } from "@indexas/key-did-provider-secp256k1-with-lit";
import { DID } from "dids";
import { LitNodeClient } from "@lit-protocol/lit-node-client";
import {randomBytes, randomString} from "@stablelib/random";
import { Cacao, SiweMessage } from "@didtools/cacao";
import { computeAddress, joinSignature } from "ethers/lib/utils";
import { getResolver } from "key-did-resolver"
import {decodeDIDWithLit, encodeDIDWithLit} from "../utils/lit";
import { appConfig } from "../config";
import { isSSR } from "../utils/helper";
import {createDIDCacao, createDIDKey, DIDSession} from "did-session";
import {getAddress} from "@ethersproject/address";
import {Ed25519Provider} from "key-did-provider-ed25519";
import {Secp256k1Provider} from "@didtools/key-secp256k1";

const checkAndSignAuthMessage = async () => JSON.parse(localStorage.getItem("authSig")!);

function stringToUInt8Array(str) {
	var buf = new ArrayBuffer(32);
	var arr = new Uint8Array(buf);
	for (var i = 0; i < str.length; i++) {
		arr[i] = str.charCodeAt(i);
	}
	return arr;
}

class LitService {
	async authenticatePKP(ipfsId: string, pkpPublicKey: any) : Promise<DID> {
		if (!isSSR()) {
			try {
				const litNodeClient = new LitNodeClient({
					litNetwork: "serrano",
				});
				await litNodeClient.connect();

				const encodedDID = await encodeDIDWithLit(pkpPublicKey);
				// @ts-ignore
				const provider = new Secp256k1ProviderWithLit({
					did: encodedDID,
					ipfsId,
					client: litNodeClient,
				});
				// @ts-ignore
				const did = new DID({ provider, resolver: KeyDidResolver.getResolver() });
				await did.authenticate();
				return did;
			} catch (err: any) {
				throw new Error(`Error authenticating DID: ${err.message}`);
			}
		} else {
			throw new Error("authenticatePKP cannot be run on the server-side");
		}
	}

	async mintPkp() {
		const litContracts = new LitContracts();
		await litContracts.connect();

		const mintCost = await litContracts.pkpNftContract.read.mintCost();

		const mint = await litContracts.pkpNftContract.write.mintNext(2, { value: mintCost });
		const wait = await mint.wait();

		const pkpMintedEventTopic = ethers.utils.id("PKPMinted(uint256,bytes)");
		const eventLog = wait.logs.find(
			(log: { topics: string[]; }) => log.topics[0] === pkpMintedEventTopic,
		);
		if (!eventLog) {
			throw new Error("PKP minted event not found");
		}

		const tokenIdFromEvent = eventLog.topics[1];
		const tokenIdNumber = ethers.BigNumber.from(tokenIdFromEvent).toString();
		const pkpPublicKey = await litContracts.pkpNftContract.read.getPubkey(tokenIdFromEvent);
		console.log(
			`superlog, PKP public key is ${pkpPublicKey} and Token ID is ${tokenIdFromEvent} and Token ID number is ${tokenIdNumber}`,
		);
		const acid = litContracts.utils.getBytesFromMultihash(appConfig.defaultCID);
		const addPermissionTx = await litContracts.pkpPermissionsContract.write.addPermittedAction(tokenIdNumber, acid, []);

		return {
			tokenIdFromEvent,
			tokenIdNumber,
			pkpPublicKey,
		};

		/*

        PKP public key is 0x04c00cfcacdd09cd14f858ec1a9771f88d170ad8ac46d5deb8cced8f24cce303ff9006ee68ff0eac11ac1e4a57dc0bc48075c6813fab164fb0b36ea2c021c51005

        and Token ID is 0x276c64f32ffe0f56396f60d1030d23d44b6ce50833856893ef0f311331f16d3f
        and Token ID number is 17831717308699365721260653288176043165957324409522683475746237039328728542527

        const tokenIdNumber = "17831717308699365721260653288176043165957324409522683475746237039328728542527"
        const signEverythingCID = "QmcZ2MuxkNrMbNKAVtK37tEmKJ8zwvFudin3rBEcHyhqJc";
        //
        const addPermissionTx = await litContracts.pkpPermissionsContractUtil.write.revokePermittedAction(tokenIdNumber, signEverythingCID);
        const aw = await addPermissionTx.wait();
        console.log(aw);

        */
	}

	async hasOriginNFT() {
		if (localStorage.getItem("hasOrigin")) {
			return true;
		}
		const litNodeClient = new LitNodeClient({
			litNetwork: "serrano",
		});
		await litNodeClient.connect();
		const authSig = await checkAndSignAuthMessage();
		const resp = await litNodeClient.executeJs({
			ipfsId: "QmaHRJzgezMwroP1EPdWhEhSbwj3ntCk46ikAuE5jvAsX1",
			targetNodeRange: 1,
			authSig,
			jsParams: {
				authSig,
				chain: "ethereum",
			},
		});
		// @ts-ignore
		const { hasOrigin } = resp.response;
		if (hasOrigin) {
			localStorage.setItem("hasOrigin", "1");
		}
		return hasOrigin;
	}

	async getPKPSession(pkpPublicKey: string, collabAction: string) {

		const encodedDID = encodeDIDWithLit(pkpPublicKey);
		const address = computeAddress(pkpPublicKey);
		const keySeed = stringToUInt8Array(encodedDID);

		const provider = new Secp256k1Provider(keySeed);
		const didKey = new DID({ provider, resolver: getResolver() });
		await didKey.authenticate();
		/*
		const existingSiwe = localStorage.getItem(`pkp_siwe_${address}`);
		if (existingSiwe) {
			const cacao = Cacao.fromSiweMessage(new SiweMessage(existingSiwe));
			return await createDIDCacao(didKey, cacao);
		}
		*/

		const litNodeClient = new LitNodeClient({
			litNetwork: "serrano",
		});
		await litNodeClient.connect();
		const authSig = await checkAndSignAuthMessage();

		const now = new Date();
		const threeMonthsLater = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

		const siweMessage = new SiweMessage({
			domain: window.location.host,
			address: getAddress(address),
			statement: "Give this application access to some of your data on Ceramic",
			uri: didKey.id,
			version: "1",
			chainId: "175177",
			nonce: randomString(10),
			issuedAt: now.toISOString(),
			expirationTime: threeMonthsLater.toISOString(),
			resources: ["ceramic://*"],
		});

		const resp = await litNodeClient.executeJs({
			ipfsId: collabAction,
			authSig,
			jsParams: {
				authSig,
				chain: "ethereum",
				publicKey: pkpPublicKey,
				message: siweMessage.toMessage(),
				sigName: "sig1",
			},
		});
		const signature = resp.signatures.sig1;
		siweMessage.signature = joinSignature({
			r: `0x${signature.r}`,
			s: `0x${signature.s}`,
			v: signature.recid,
		});
		localStorage.setItem(`pkp_siwe_${address}`, siweMessage.toMessage());
		const cacao = Cacao.fromSiweMessage(siweMessage);
		const did = await createDIDCacao(didKey, cacao);
		return new DIDSession({ cacao, keySeed, did });
	}
}
const litService = new LitService();
export default litService;
