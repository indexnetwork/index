const { Client } = require('@elastic/elasticsearch')

const client = new Client({ node: process.env.ELASTIC_HOST })

const RedisClient = require('../clients/redis.js');
const redis = RedisClient.getInstance();

const {getIndexById, getIndexLinkById, getLinkById} = require("./composedb");

const config = {
    indexName: 'links'
}

module.exports.createIndex = async (indexMsg) => {
    console.log("createIndex", indexMsg)

    let index = await getIndexById(indexMsg.id)

    await client.index({
        index: config.indexName,
        id: `index-${index.id}`,
        refresh: true,
        body: {
            doc: {
                index
            }
        },
    });

    console.log(index)

    // Create user_index without a composedb record. Only remove requests are stored in composedb.
    await this.createUserIndex({
        "controller_did": index.owner_did.id,
        "type":"my_indexes",
        "index_id": index.id,
        "created_at": new Date().toISOString()
    });

}
module.exports.updateIndex = async (indexMsg) => {
    console.log("updateIndex", indexMsg)

    let index = await getIndexById(indexMsg.id)

    //Index index
    await client.index({
        index: config.indexName,
        id: `index-${index.id}`,
        refresh: true,
        body: {
            doc: {
                index
            }
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
module.exports.createIndexLink = async (indexLinkMsg) => {
    console.log("createIndexLink", indexLinkMsg)

    let indexLink = await getIndexLinkById(indexLinkMsg.id)
    delete indexLink.link.content // TODO fix stored in the indexer only, for now.

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
    delete indexLink.link.content  // TODO fix stored in the indexer only, for now.

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


module.exports.createLink = async (link) => {
    console.log("createLink - Ignore", link)
}

module.exports.updateLink = async (linkMsg) => {

    console.log("updateLink", linkMsg)
    const link = await getLinkById(linkMsg.id)
    delete link.content
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
