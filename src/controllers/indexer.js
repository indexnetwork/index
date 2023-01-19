const _ = require('lodash')
const { Client } = require('@elastic/elasticsearch')
//const client = new Client({ node: process.env.ELASTIC_HOST })
const config = {
    indexName: 'links'
}

module.exports.createIndex = async (index) => {
    console.log(index)
    return;
    await client.index({
        index: config.indexName,
        id: `index-${index.id}`,
        refresh: true,
        body: index,
    })
}

module.exports.updateIndex = async (index) => {
    // Todo handle links update
    console.log(index)
    return;

    await client.index({
        index: config.indexName,
        id: `index-${doc.index.id}`,
        refresh: true,
        body: doc,
    })
}

module.exports.createLink = async (link) => {
    console.log("createLink", link)
}

module.exports.updateLink = async (link) => {
    console.log("updateLink", link)
}

