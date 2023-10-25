import dotenv from 'dotenv'
import axios from 'axios'

if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}

import { Client } from '@elastic/elasticsearch'

const client = new Client({ node: process.env.ELASTIC_HOST })

import RedisClient from '../clients/redis.js';
const redis = RedisClient.getInstance();

import {getIndexById, getIndexLinkById, getLinkById, getProfileById, getUserIndexById} from "./composedb.js";

const config = {
    indexName: 'links'
}

export const createIndex = async (indexId) => {
    console.log("createIndex", indexId)

    let index = await getIndexById(indexId)

    await client.index({
        index: config.indexName,
        id: `index-${index.id}`,
        refresh: true,
        document: {
            index
        },
    });

    console.log(index)

    // TODO Handle before mainnet.
    /* Creates user_index without a composedb record. Only remove requests are stored in composedb.
    await this.createUserIndex({
        "controllerDID": index.ownerDID.id,
        "type":"owner",
        "indexId": index.id,
        "createdAt": new Date().toISOString()
    });
     */

}
export const updateIndex = async (indexId) => {
    console.log("updateIndex", indexId)

    let index = await getIndexById(indexId)

    //Index index
    await client.index({
        index: config.indexName,
        id: `index-${index.id}`,
        refresh: true,
        document: {
            index
        },
    })

    //Index links
    await client.updateByQuery({
        index: config.indexName,
        refresh: true,
        conflicts: "proceed",
        script: {
            lang: 'painless',
            source: 'ctx._source.index = params.index',
            params: {
                index: index
            }
        },
        query: {
            bool: {
                must: [
                    {
                        term: {
                            "index.id": index.id
                        },
                    },
                    {
                        exists: {
                            field: "id",
                        },
                    }
                ],
            },
        },
    })
}
export const createIndexLink = async (indexLinkId) => {
    console.log("createIndexLink", indexLinkId)
    let indexLink = await getIndexLinkById(indexLinkId)

    try {
        await axios.post(`http://llm-indexer.testnet/index/${indexLink.indexId}/links`, {url: indexLink.link.url})
    } catch (e) {
        console.log("Indexer error:", e.message);
    }
    delete indexLink.link.content // TODO fix stored in the indexer only, for now.
    indexLink.link.url_exact_match = indexLink.link.url;
    await client.update({
        index: config.indexName,
        id: indexLink.id,
        refresh: true,
        doc_as_upsert: true,
        doc: indexLink,
    })
}
export const updateIndexLink = async (indexLinkId) => {

    console.log("updateIndexLink", indexLinkId)

    let indexLink = await getIndexLinkById(indexLinkId)
    delete indexLink.link.content  // TODO fix stored in the indexer only, for now.
    indexLink.link.url_exact_match = indexLink.link.url;
    await client.update({
        index: config.indexName,
        id: indexLink.id,
        refresh: true,
        doc_as_upsert: true,
        doc: indexLink
    })
}


export const createLink = async (link) => {
    console.log("createLink - Ignore", link)
}

export const updateLink = async (linkId) => {

    console.log("updateLink", linkId)
    const link = await getLinkById(linkId)
    delete link.content
    link.url_exact_match = link.url;
    //Index links
    await client.updateByQuery({
        index: config.indexName,
        refresh: true,
        conflicts: "proceed",
        script: {
            lang: 'painless',
            source: 'ctx._source.link = params.link',
            params: {
                link
            }
        },
        query: {
            bool: {
                must: [
                    {
                        term: {
                            "link.id": link.id
                        },
                    }
                ],
            },
        },
    })
}



export const updateLinkContent = async (url, content) => {

    console.log("updateLinkContent", url, content)

    await client.updateByQuery({
        index: config.indexName,
        refresh: true,
        conflicts: "proceed",
        script: {
            lang: 'painless',
            source: 'ctx._source.link.content = params.content',
            params: {
                content
            }
        },
        query: {
            bool: {
                must: [
                    {
                        term: {
                            "link.url_exact_match": url
                        }
                    },
                    {
                        exists: {
                            field: "id",
                        },
                    }
                ],
            },
        },
    })
}
export const createUserIndex = async (userIndexId) => {
    console.log("createUserIndex", userIndexId)
    const userIndex = await getUserIndexById(userIndexId)
    await redis.hSet(`user_indexes:by_did:${userIndex.controllerDID.toLowerCase()}`, `${userIndex.indexId}:${userIndex.type}`, JSON.stringify(userIndex))
}
export const updateUserIndex = async (userIndexId) => {
    console.log("createUserIndex", userIndexId)
    const userIndex = await getUserIndexById(userIndexId)
    if(userIndex.deletedAt){
        await redis.hDel(`user_indexes:by_did:${userIndex.controllerDID.toLowerCase()}`, `${userIndex.indexId}:${userIndex.type}`)
    }
}


export const createProfile = async (id) => {
    console.log("createUserIndex", id)
    const profile = await getProfileById(id)
    profile.id = profile.controllerDID.id;
    delete profile.controllerDID;
    await redis.hSet(`profiles`, profile.id.toString(), JSON.stringify(profile));

}
export const updateProfile = async (id) => {
    return await createProfile(id);
}
