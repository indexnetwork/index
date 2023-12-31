import fs from 'fs/promises';

import { NodeVM } from 'vm2';
import { TextEncoder, TextDecoder } from "util";

import { LitContracts } from "@lit-protocol/contracts-sdk";
import { DID } from "dids";
import * as LitJsSdk from "@lit-protocol/lit-node-client";
import { randomBytes, randomString } from "@stablelib/random";
import { Cacao } from "@didtools/cacao";
import { getResolver } from "key-did-resolver";
import { createDIDCacao, DIDSession } from "did-session";
import { Ed25519Provider } from "key-did-provider-ed25519";

import RedisClient from '../clients/redis.js';
import IPFSClient from '../clients/ipfs.js';
const redis = RedisClient.getInstance();

//import { Index } from '../protocol.ts';

import { getNftMetadataApi, getCollectionMetadataApi, getENSProfileByWallet } from '../libs/infura.js';

const enrichConditions = async (conditions) => {

    conditions = await Promise.all(conditions.map( async (condition) => {

        if(condition.operator === "or"){
            return condition;
        }

        if(!condition.contractAddress){
            condition.metadata = {
                ruleType: "individualWallet",
                walletAddress: condition.returnValueTest.value,
                chain: condition.chain,
            };

            let profile = await getENSProfileByWallet(condition.returnValueTest.value);
            if(profile){
                condition.metadata.ensName = profile.ensName;
                if(profile.image){
                    condition.metadata.image = profile.image;
                }
            }
            return condition;
        }

        if(condition.standardContractType) {
            if (condition.standardContractType === "ERC20") {
                condition.metadata = {
                    ruleType: "nftOwner",
                    chain: condition.chain,
                    contractAddress: condition.contractAddress,
                }
            } else if (condition.standardContractType === "ERC721") {
                condition.metadata = {
                    ruleType: "nftOwner",
                    chain: condition.chain,
                    contractAddress: condition.contractAddress,
                }
                if (condition.method === "ownerOf") {
                    condition.metadata.tokenId = condition.parameters[0];
                }
            } else if (condition.standardContractType === "ERC1155") {
                condition.metadata = {
                    ruleType: "nftOwner",
                    chain: condition.chain,
                    contractAddress: condition.contractAddress,
                    tokenId: condition.parameters[1],
                }
            }
            let collectionMetadata = await getCollectionMetadataApi(condition.chain, condition.contractAddress);
            if(collectionMetadata){
                condition.metadata.standardContractType = condition.standardContractType;
                condition.metadata.symbol = collectionMetadata.symbol;
                if(condition.metadata.tokenId){
                    let tokenMetadata = await getNftMetadataApi(condition.chain, condition.contractAddress, condition.metadata.tokenId);
                    if(tokenMetadata){
                        if(condition.standardContractType === "ERC721"){
                            condition.metadata.name = `${collectionMetadata.name} - ${tokenMetadata.metadata.name}`;
                            condition.metadata.image = tokenMetadata.metadata.image;
                        }
                        if(condition.standardContractType === "ERC1155"){
                            condition.metadata.name = tokenMetadata.metadata.name;
                            condition.metadata.image = tokenMetadata.metadata.image;
                        }
                    }else{
                        condition.metadata.name = collectionMetadata.name;
                    }
                }else{
                    condition.metadata.name = collectionMetadata.name
                }
            }
        }

        return condition;

    }));

    return conditions;
}

export const get_action = async (req, res, next) => {

    const { cid } = req.params;

    const cached = await redis.hGet(`lit_actions`, cid);
    if (cached) {
        return res.json(JSON.parse(cached))
    }

    try {

        const runner =  new NodeVM({
            console: 'redirect',
            sandbox: {
                TextEncoder,
                TextDecoder,
            },
            env: {
                ACTION_CALL_MODE: 'read'
            }
        })

        runner.on('console.log', async (data) => {

            let conditions = JSON.parse(data);
            let enrichedConditions = await enrichConditions(conditions);
            await redis.hSet(`lit_actions`, cid, JSON.stringify(enrichedConditions));
            return res.json(enrichedConditions)
        });

        const litAction = await fetch(`https://indexas.infura-ipfs.io/ipfs/${cid}`);
        let litActionStr = await litAction.text();
        litActionStr = `const ACTION_CALL_MODE="read"; ${litActionStr}`;
        await runner.run(litActionStr);

    } catch (err) {
        return res.json({"error": "No action found"});
    }

};
export const post_action = async (req, res, next) => {

    let actionStr = await fs.readFile('lit_action.js', 'utf8');
    actionStr = actionStr.replace('__REPLACE_THIS_AS_CONDITIONS_ARRAY__', JSON.stringify(req.body));

    IPFSClient.add(actionStr).then((r) => {
        return res.json(r.path)
    });
};

export const getPKPSession = async (index) => {

    const { accessControl } = index
    const existingSessionStr = await redis.hGet(`sessions:${accessControl.signerPublicKey}`);

    if (existingSessionStr) {
        try {
            const didSession = await DIDSession.fromSession(existingSessionStr);
            await didSession.did.authenticate();
            return didSession;
        } catch (error) {
            //Expired or invalid session, remove cache.
            console.warn(error);
            await redis.hDel(`sessions:${accessControl.signerPublicKey}`);
        }
    }

    const keySeed = randomBytes(32);
    const provider = new Ed25519Provider(keySeed);
    // @ts-ignore
    const didKey = new DID({ provider, resolver: getResolver() });
    await didKey.authenticate();

    const litNodeClient = new LitJsSdk.LitNodeClient({
        litNetwork: config.litNetwork,
    });
    await litNodeClient.connect();

    const resp = await litNodeClient.executeJs({
        ipfsId: accessControl.signerFunction,
        authSig: config.authSignature,
        jsParams: {
            authSig,
            chain: "ethereum",
            publicKey: accessControl.signerPublicKey,
            didKey: didKey.id,
            nonce: randomString(10),
            domain: window.location.host,
            sigName: "sig1",
        },
    });
    // @ts-ignore
    const { error } = resp.response; // TODO Handle.
    if (error) {
        console.log(error)
        return null;
    }
    // @ts-ignore
    const siweMessage = JSON.parse(resp.response.context);
    const signature = resp.signatures.sig1; // TODO Handle.
    siweMessage.signature = ethers.Signature.from({
        r: `0x${signature.r}`,
        s: `0x${signature.s}`,
        v: signature.recid,
    }).serialized;

    const cacao = Cacao.fromSiweMessage(siweMessage);
    const did = await createDIDCacao(didKey, cacao);
    const session = new DIDSession({ cacao, keySeed, did });
    await redis.hSet(`sessions:${accessControl.signerPublicKey}`, session.serialize());
    return session;
}
