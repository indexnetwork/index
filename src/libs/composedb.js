const _ = require('lodash')

const RedisClient = require('../clients/redis.js');
const redis = RedisClient.getInstance();


module.exports.getIndexById = async (id) => {
        let results = await fetch(`${process.env.COMPOSEDB_HOST}/graphql`, {
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
                    controller_did {
                        id
                    }
                }}
          }`
        })
    })

    let res = await results.json();
    let index = res.data.node;

    index.controller_did = index.controller_did.id
    if(index){
        index.owner_did = await redis.hGet(`pkp:owner`, index.controller_did.id)
        return res.data.node
    }else{
        return false;
    }
}

module.exports.getIndexByPKP = async (id) => {

    let results = await fetch('https://composedb-client/graphql', {
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

