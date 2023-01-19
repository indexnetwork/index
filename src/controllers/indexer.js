const _ = require('lodash')
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
}

module.exports.createLink = async (link) => {
    console.log("createLink", link)
    //TODO Client get index
    await client.index({
        index: config.indexName,
        id: link.id,
        refresh: true,
        body: {
            ...link,
            //...transformIndex(index)
        },
    })
}

module.exports.updateLink = async (link) => {
    console.log("updateLink", link)
    await client.index({
        index: config.indexName,
        id: link.id,
        refresh: true,
        body: {
            ...link,
            //...transformIndex(index)
        },
    })
}

