import { ethers } from "ethers";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { DID } from "dids";
import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { randomBytes, randomString } from "@stablelib/random";
import { Cacao, SiweMessage } from "@didtools/cacao";
import { computeAddress, joinSignature } from "ethers/lib/utils";
import { getResolver } from "key-did-resolver";
import { createDIDCacao, DIDSession } from "did-session";
import { getAddress } from "@ethersproject/address";
import { AccountId } from "caip";
import { Ed25519Provider } from "key-did-provider-ed25519";
import { appConfig } from "../config";

const checkAndSignAuthMessage = async () => JSON.parse(localStorage.getItem("authSig")!);

class LitService {
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
		const existingSessionStr = localStorage.getItem(`pkp_${pkpPublicKey}`);
		if (existingSessionStr) {
			const es = JSON.parse(existingSessionStr);
			if (es.isPermittedAddress || (es.isCreator && es.collabAction === collabAction)) {
				const existing = await DIDSession.fromSession(es.session);
				await existing.did.authenticate();
				es.session = existing;
				return es;
			}
		}

		const keySeed = randomBytes(32);
		const provider = new Ed25519Provider(keySeed);
		// @ts-ignore
		const didKey = new DID({ provider, resolver: getResolver() });
		await didKey.authenticate();

		const litNodeClient = new LitNodeClient({
			litNetwork: "serrano",
		});
		await litNodeClient.connect();
		const authSig = await checkAndSignAuthMessage();

		const resp = await litNodeClient.executeJs({
			ipfsId: collabAction,
			authSig,
			jsParams: {
				authSig,
				chain: "ethereum",
				publicKey: pkpPublicKey,
				didKey: didKey.id,
				nonce: randomString(10),
				domain: window.location.host,
				sigName: "sig1",
			},
		});
		// @ts-ignore
		const { error } = resp.response; //TODO Handle.
		// @ts-ignore
		const { isCreator, isPermittedAddress, siweMessage} = JSON.parse(resp.response.context);

		const signature = resp.signatures.sig1;
		siweMessage.signature = joinSignature({
			r: `0x${signature.r}`,
			s: `0x${signature.s}`,
			v: signature.recid,
		});
		const cacao = Cacao.fromSiweMessage(siweMessage);
		const did = await createDIDCacao(didKey, cacao);
		const session = new DIDSession({ cacao, keySeed, did });

		localStorage.setItem(`pkp_${pkpPublicKey}`, JSON.stringify({
			isCreator,
			isPermittedAddress,
			collabAction,
			session: session.serialize(),
		}));
		return { session, isCreator, isPermittedAddress, collabAction };
	}
}
const litService = new LitService();
export default litService;
