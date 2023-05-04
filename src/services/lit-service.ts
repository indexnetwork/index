import { ethers } from "ethers";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { encodeDIDWithLit, Secp256k1ProviderWithLit } from "@indexas/key-did-provider-secp256k1-with-lit";
import { DID } from "dids";
import * as KeyDidResolver from "key-did-resolver";
import * as LitJsSdk from "@lit-protocol/lit-node-client";
import { isSSR } from "../utils/helper";
import { appConfig } from "../config";

const checkAndSignAuthMessage = async () => JSON.parse(localStorage.getItem("authSig")!);

class LitService {
	async authenticatePKP(ipfsId: string, pkpPublicKey: any) : Promise<DID> {
		if (!isSSR()) {
			try {
				const encodedDID = await encodeDIDWithLit(pkpPublicKey);
				const provider = new Secp256k1ProviderWithLit({
					did: encodedDID,
					ipfsId,
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
		console.log(mintCost);
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
			`PKP public key is ${pkpPublicKey} and Token ID is ${tokenIdFromEvent} and Token ID number is ${tokenIdNumber}`,
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
		const litNodeClient = new LitJsSdk.LitNodeClient({
			litNetwork: "serrano",
		});
		await litNodeClient.connect();
		const authSig = await checkAndSignAuthMessage();
		const resp = await litNodeClient.executeJs({
			ipfsId: "QmPei4LwUCvBncACjUVC5JKF1WqBCHzy9ZzJ7DBCzgdhAB",
			targetNodeRange: 1,
			authSig,
			jsParams: {
				authSig,
				chain: "ethereum",
			},
		});
		// @ts-ignore
		return resp.response.hasOrigin;
	}
}
const litService = new LitService();

export default litService;
