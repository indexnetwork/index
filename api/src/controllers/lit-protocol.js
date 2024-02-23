import fs from 'fs/promises';

import { NodeVM } from 'vm2';
import { TextEncoder, TextDecoder } from "util";


import RedisClient from '../clients/redis.js';
const redis = RedisClient.getInstance();
import  pinataSDK from '@pinata/sdk';

import { Readable } from "stream";


//import { Index } from '../protocol.ts';

import { getNftMetadataApi, getCollectionMetadataApi, getENSProfileByWallet } from '../controllers/infura.js';

const enrichConditions = async (conditions) => {


    conditions = await Promise.all(conditions.map( async (c) => {

        let { value, tag } = c;
        if(!value.contractAddress){
            value.metadata = {
                ruleType: "individualWallet",
                walletAddress: value.returnValueTest.value,
                chain: value.chain,
            };

            let profile = await getENSProfileByWallet(value.returnValueTest.value);
            if(profile){
                value.metadata.ensName = profile.ensName;
                if(profile.image){
                    value.metadata.image = profile.image;
                }
            }
            c.value = value;
            return c;
        }

        if(value.standardContractType) {
            if (value.standardContractType === "ERC20") {
                value.metadata = {
                    ruleType: "nftOwner",
                    chain: value.chain,
                    contractAddress: value.contractAddress,
                }
            } else if (value.standardContractType === "ERC721") {
                value.metadata = {
                    ruleType: "nftOwner",
                    chain: value.chain,
                    contractAddress: value.contractAddress,
                }
                if (value.method === "ownerOf") {
                    value.metadata.tokenId = value.parameters[0];
                }
            } else if (value.standardContractType === "ERC1155") {
                value.metadata = {
                    ruleType: "nftOwner",
                    chain: value.chain,
                    contractAddress: value.contractAddress,
                    tokenId: value.parameters[1],
                }
            }
            let collectionMetadata = await getCollectionMetadataApi(value.chain, value.contractAddress);
            if(collectionMetadata){
                value.metadata.standardContractType = value.standardContractType;
                value.metadata.symbol = collectionMetadata.symbol;
                if(value.metadata.tokenId){
                    let tokenMetadata = await getNftMetadataApi(value.chain, value.contractAddress, value.metadata.tokenId);
                    if(tokenMetadata){
                        if(value.standardContractType === "ERC721"){
                            value.metadata.name = `${collectionMetadata.name} - ${tokenMetadata.metadata.name}`;
                            value.metadata.image = tokenMetadata.metadata.image;
                        }
                        if(value.standardContractType === "ERC1155"){
                            value.metadata.name = tokenMetadata.metadata.name;
                            value.metadata.image = tokenMetadata.metadata.image;
                        }
                    }else{
                        value.metadata.name = collectionMetadata.name;
                    }
                }else{
                    value.metadata.name = collectionMetadata.name
                }
            }
        }

        c.value = value;
        return c;
    }));

    return conditions;
}

export const getAction = async (req, res, next) => {

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

        const litAction = await fetch(`https://ipfs.index.network/ipfs/${cid}?pinataGatewayToken=${process.env.PINATA_IPFS_GATEWAY_KEY}`);
        let litActionStr = await litAction.text();
        litActionStr = `const ACTION_CALL_MODE="read"; ${litActionStr}`;
        await runner.run(litActionStr);

    } catch (err) {
        console.log(err)
        return res.json({"error": "No action found"});
    }

};
export const postAction = async (req, res, next) => {

    let actionStr = await fs.readFile('lit_action.js', 'utf8');
    actionStr = actionStr.replace('__REPLACE_THIS_AS_CONDITIONS_ARRAY__', JSON.stringify(req.body));

    const pinata = new pinataSDK({ pinataJWTKey: process.env.PINATA_JWT_KEY});

    const buffer = Buffer.from(actionStr, "utf8");
		const stream = Readable.from(buffer);

		stream.path = "string.txt";

		const resp = await pinata.pinFileToIPFS(stream,{
		  pinataMetadata: { name: "signerFunction" }
		})

		return res.json({
		  cid: resp.IpfsHash
		})
};
