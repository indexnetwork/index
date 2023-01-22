const _ = require('lodash')

const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: process.env.ELASTIC_HOST })



async function getIndexById(id) {
    let results = await fetch('http://composedb/graphql', {
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

    const index = await getIndexById(link.index_id)
    await client.index({
        index: config.indexName,
        id: link.id,
        refresh: true,
        body: {
            ...link,
            ...transformIndex(index)
        },
    })
}

module.exports.updateLink = async (link) => {
    console.log("updateLink", link)
    const index = await getIndexById(link.index_id)
    await client.index({
        index: config.indexName,
        id: link.id,
        refresh: true,
        body: {
            ...link,
            ...transformIndex(index)
        },
    })
}

