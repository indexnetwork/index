const { Client } = require('@elastic/elasticsearch')

const client = new Client({ node: process.env.ELASTIC_HOST })

const RedisClient = require('../clients/redis.js');
const redis = RedisClient.getInstance();

const {getIndexById, getIndexLinkById} = require("./composedb");

const config = {
    indexName: 'links'
}

const transformIndex = (index) => {
    return {
        index: index,
        index_id: index.id
    }
}
module.exports.createIndex = async (indexMsg) => {
    console.log("createIndex", indexMsg)

    let index = await getIndexById(indexMsg.id)

    await client.index({
        index: config.indexName,
        id: `index-${index.id}`,
        refresh: true,
        body: {
            index
        },
    })
}
module.exports.updateIndex = async (indexMsg) => {
    console.log("updateIndex", indexMsg)

    let index = await getIndexById(indexMsg.id)

    await client.index({
        index: config.indexName,
        id: `index-${index.id}`,
        refresh: true,
        body: {
            index
        },
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
module.exports.createIndexLink = async (indexLinkMsg) => {
    console.log("createIndexLink", indexLinkMsg)

    let indexLink = await getIndexLinkById(indexLinkMsg.id)
    delete indexLink.link.content

    await client.update({
        index: config.indexName,
        id: indexLink.id,
        refresh: true,
        doc_as_upsert: true,
        body: {
            doc: indexLink
        },
    })
}
module.exports.updateIndexLink = async (indexLinkMsg) => {

    console.log("updateIndexLink", indexLinkMsg)

    let indexLink = await getIndexLinkById(indexLinkMsg.id)
    delete indexLink.link.content

    await client.update({
        index: config.indexName,
        id: indexLink.id,
        refresh: true,
        doc_as_upsert: true,
        body: {
            doc: indexLink
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
