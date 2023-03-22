const _ = require('lodash')

const RedisClient = require('../clients/redis.js');
const redis = RedisClient.getInstance();

module.exports.getIndexLinkById = async(id) => {
    let results = await fetch(`${process.env.COMPOSEDB_HOST}/graphql`, {
        method: 'POST',
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            query: `{
              node(id: "${id}") {
                ... on IndexLink {
                  id
                  created_at
                  updated_at
                  deleted_at
                  indexer_did {
                    id
                  }
                  index {
                    id
                    controller_did {
                      id
                    }        
                    title
                    collab_action
                    created_at
                    updated_at
            
                  }
                  link {
                    id
                    controller_did {
                      id
                    }
                    title
                    url
                    favicon
                    tags
                    content
                    created_at
                    updated_at
                    deleted_at
                  }
                }
              }
            }`
        })
    })
    let res = await results.json();
    return res.data.node;
}

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

    //TODO fix updated at.
    /*

				links(last:1) {
					edges {
					  node {
						created_at
						updated_at
					  }
					}
				}
    if (node.links.edges.length > 0 && (moment(node.links.edges[0].node.updated_at) > moment(node.updated_at))) {
        node.updated_at = node.links.edges[0].node.updated_at;
    }
    */

    let res = await results.json();
    let index = res.data.node;

    if(index){
        // index.controller_did = index.controller_did.id
        const owner_did = await redis.hGet(`pkp:owner`, index.controller_did.id)
        if(owner_did){
            index.owner_did = { id: owner_did, basicProfile: null}
        }
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

