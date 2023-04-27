import _ from 'lodash';
import RedisClient from '../clients/redis.js';
import moment from "moment";

const redis = RedisClient.getInstance();

export const getIndexLinkById = async(id) => {
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
                  index_id
                  link_id
                  created_at
                  updated_at
                  deleted_at
                  indexer_did {
                    id
                  }
                  controller_did {
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


export const getLinkById = async(id) => {
    let results = await fetch(`${process.env.COMPOSEDB_HOST}/graphql`, {
        method: 'POST',
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            query: `{
              node(id: "${id}") {
                ... on Link {
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
            }`
        })
    })
    let res = await results.json();
    return res.data.node;
}

export const getIndexById = async (id) => {
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
                    links(last:1) {
                        edges {
                          node {
                            updated_at
                          }
                        }
                    }                    
                }}
          }`
        })
    })

    let res = await results.json();
    let index = res.data.node;

    if(!index){
        return false;
    }

    if (index.links.edges.length > 0 && (moment(index.links.edges[0].node.updated_at) > moment(index.updated_at))) {
        index.updated_at = index.links.edges[0].node.updated_at;
    }

    delete index.links;

    const owner_did = await redis.hGet(`pkp:owner`, index.controller_did.id.toLowerCase())
    if(owner_did){
        index.owner_did = { id: owner_did, basicProfile: null}
    }
    return index

}

export const getIndexByPKP = async (id) => {

    let results = await fetch(`${process.env.COMPOSEDB_HOST}/graphql`, {
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
                        title
                        collab_action
                        created_at
                        updated_at
                        controller_did {
                            id
                        }
                        links(last:1) {
                            edges {
                                node {
                                    updated_at
                                }
                            }
                        }                           
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
    if(indexes.length === 0){
        return false;
    }
    let index = indexes[0].node.id;

    if (index.links.edges.length > 0 && (moment(index.links.edges[0].node.updated_at) > moment(index.updated_at))) {
        index.updated_at = index.links.edges[0].node.updated_at;
    }
    delete index.links

    const owner_did = await redis.hGet(`pkp:owner`, index.controller_did.id.toLowerCase())
    if(owner_did){
        index.owner_did = { id: owner_did, basicProfile: null}
    }
    return index;
}

