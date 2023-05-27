import fs from 'fs/promises';

import {NodeVM} from 'vm2';
import { TextEncoder, TextDecoder } from "util";

import { create } from 'ipfs-http-client'

import RedisClient from '../clients/redis.js';
const redis = RedisClient.getInstance();


const enrichConditions = async (conditions) => {

    conditions = await Promise.all(conditions.map( async (condition) => {

        if(condition.contractAddress !== "evmBasic"){
            return condition;
        }

        if(condition.method === "ownerOf"){
            condition.metadata = {
                ruleType: "nftOwner",
                chain: condition.chain,
                contractAddress: condition.contractAddress,
                tokenId: condition.parameters[0],
                title: 'Content heroes'
            }
        } else if(condition.method === "balanceOf"){
            condition.metadata = {
                ruleType: "nftOwner",
                chain: condition.chain,
                contractAddress: condition.contractAddress,
                title: 'Content heroes'
            }
        } else if(condition.parameters[0] === ":userAddress"){
            condition.metadata = {
                ruleType: "wallet",
                chain: condition.chain,
                address: condition.returnValueTest.value,
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
    if(cached){
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

        const litAction = await fetch(`https://ipfs.io/ipfs/${cid}`);
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
