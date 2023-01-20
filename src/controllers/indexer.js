const _ = require('lodash')

async function getIndexById(id) {
    let results = await fetch('http://localhost:35000/graphql', {
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
                }}
          }`
        })
    })
    let res = await results.json();
    return res.data.node
}

const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: process.env.ELASTIC_HOST })




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
    await client.index({
        index: config.indexName,
        id: `index-${index.id}`,
        refresh: true,
        body: transformIndex(index),
    })
}

module.exports.updateIndex = async (index) => {

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

