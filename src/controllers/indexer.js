const {getPkpPublicKey, decodeDIDWithLit, encodeDIDWithLit, walletToDID, getOwner} = require('../utils/lit/index.js')

const _ = require('lodash')
const { Client } = require('@elastic/elasticsearch')

if(process.env.NODE_ENV !== 'production'){
    require('dotenv').config()
}

const client = new Client({ node: process.env.ELASTIC_HOST })

const RedisClient = require('../clients/redis.js');
const redis = RedisClient.getInstance();

async function getIndexById(id) {
    let results = await fetch('http://composedb-client/graphql', {
        method: 'POST',
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            query: `{
                node(id:"${id}"){
                  id
                  ... on Index{
                    id
                    title
                    collab_action
                    created_at
                    updated_at
                    owner {
                        id
                    }
                }}
          }`
        })
    })
    let res = await results.json();
    res.data.node.controller_did = res.data.node.owner.id
    delete res.data.node.owner
    return res.data.node
}

async function getIndexByPKP(id) {

    let results = await fetch('https://composedb.index.as/composedb/graphql', {
        method: 'POST',
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            query: `{
              node(id: "${id}") {
                ... on CeramicAccount {
                  id
                  indexList(first: 1) {
                    edges {
                      node {
                        id
                      }
                    }
                  }
                }
              }
            }`
        })
    })
    let res = await results.json();
    let indexes = res.data.node.indexList.edges
    if(indexes.length > 0){
        return indexes[0].node.id
    }
    return false;
}



const config = {
    indexName: 'links'
}

const transformIndex = (index) => {
    return {
        index: index,
        index_id: index.id
    }
}
module.exports.createIndex = async (index) => {
    console.log("createIndex", index)

    await client.index({
        index: config.indexName,
        id: `index-${index.id}`,
        refresh: true,
        body: transformIndex(index),
    })

    if(index.controller_did.startsWith('did:key:')){
        const pkpPublicKey = decodeDIDWithLit(index.controller_did)
        const pkpOwner = await getOwner(pkpPublicKey);
        if(pkpOwner){
            const ownerDID = walletToDID("80001", pkpOwner);
            await this.createUserIndex({
                "controller_did": walletToDID("80001", pkpOwner),
                "type":"my_indexes",
                "index_id": index.id,
                "created_at": new Date().toISOString()
            })
        }
    }

}

module.exports.updateIndex = async (index) => {
    console.log("updateIndex", index)

    await client.index({
        index: config.indexName,
        id: `index-${index.id}`,
        refresh: true,
        body: transformIndex(index),
    })

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
                            index_id: index.id
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

module.exports.createLink = async (link) => {
    console.log("createLink", link)

    delete link.content
    const index = await getIndexById(link.index_id)
    await client.update({
        index: config.indexName,
        id: link.id,
        refresh: true,
        doc_as_upsert: true,
        body: {
            doc: {
                ...link,
                ...transformIndex(index)
            }
        },
    })
}

module.exports.updateLink = async (link) => {

    delete link.content
    console.log("updateLink", link)
    const index = await getIndexById(link.index_id)
    await client.update({
        index: config.indexName,
        id: link.id,
        refresh: true,
        doc_as_upsert: true,
        body: {
            doc: {
                ...link,
                ...transformIndex(index)
            }
        },
    })
}


module.exports.updateLinkContent = async (url, content) => {

    console.log("updateLinkContent", url, content)

    await client.updateByQuery({
        index: config.indexName,
        refresh: true,
        conflicts: "proceed",
        script: {
            lang: 'painless',
            source: 'ctx._source.content = params.content',
            params: {
                content
            }
        },
        query: {

            bool: {
                must: [
                    {
                        "multi_match": {
                            "query": url,
                            "type": "bool_prefix",
                            "fields": [
                                "url"
                            ],
                            "minimum_should_match": "100%"
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

module.exports.indexPKP = async (req, res, next) => {

    //TODO validate moralis ofcourse.
    const { chainId, nftTransfers } = req.body;

    if(nftTransfers.length === 0){
        return res.status(200).end();
    }

    const event = nftTransfers[0]

    let pkpPubKey = await getPkpPublicKey(event.tokenId)
    let pkpDID = encodeDIDWithLit(pkpPubKey);
    let indexId = await getIndexByPKP(pkpDID);

    if(indexId){
        await this.createUserIndex({
            "controller_did": walletToDID(chainId, event.to),
            "type":"my_indexes",
            "index_id": indexId,
            "created_at": new Date().toISOString()
        })

        if(event.from !== "0x0000000000000000000000000000000000000000"){
            await this.updateUserIndex({
                "controller_did": walletToDID(chainId, event.from),
                "type":"my_indexes",
                "index_id": indexId,
                "created_at": new Date().toISOString(),
                "deleted_at": new Date().toISOString()
            })
        }
    }
    return res.status(201).end();
}
module.exports.createUserIndex = async (user_index) => {
    console.log("createUserIndex", user_index)
    await redis.hSet(`user_indexes:by_did:${user_index.controller_did.toLowerCase()}`, `${user_index.index_id}:${user_index.type}`, JSON.stringify(user_index))
}

module.exports.updateUserIndex = async (user_index) => {
    console.log("updateUserIndex", user_index)
    if(user_index.deleted_at){
        await redis.hDel(`user_indexes:by_did:${user_index.controller_did.toLowerCase()}`, `${user_index.index_id}:${user_index.type}`)
    }
}
