import fs from 'fs/promises';

import {NodeVM} from 'vm2';
import { TextEncoder, TextDecoder } from "util";

import { create } from 'ipfs-http-client'

import RedisClient from '../clients/redis.js';
const redis = RedisClient.getInstance();

import {getNftMetadataApi, getCollectionMetadataApi, getProfile} from '../libs/infura.js';

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

            let profile = await getProfile(condition.returnValueTest.value);
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
                }
            }
        }

        return condition;

    }));

    return conditions;
}


const projectId = process.env.INFURA_PROJECT_ID;
const projectSecret = process.env.INFURA_PROJECT_SECRET;

const auth =
    'Basic ' + Buffer.from(projectId + ':' + projectSecret).toString('base64');

const ipfs = create({
    host: 'ipfs.infura.io',
    port: 5001,
    protocol: 'https',
    headers: {
        authorization: auth,
    },
});

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

    ipfs.add(actionStr).then((r) => {
        return res.json(r.path)
    });
};
