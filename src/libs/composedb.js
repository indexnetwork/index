import moment from "moment";
import { getOwnerProfile } from "../libs/lit/index.js";
import { DIDSession } from "did-session"

import { profileFragment, indexLinkFragment, userIndexFragment, linkFragment, indexFragment } from '../types/fragments.js';


export const getCurrentDateTime = () => moment.utc().toISOString();

import { ComposeClient }from "@composedb/client"
import { definition } from "../types/merged-runtime.js";

export const addIndexLink = async(indexId, linkId, session) => {

    const didSession = await DIDSession.fromSession(session);
    await didSession.did.authenticate();

    const composeClient = new ComposeClient({
        ceramic: "https://composedb.index.network",
        definition: definition,
    });

    composeClient.setDID(didSession.did);
    const indexLink = {
        indexId,
        linkId,
        updatedAt: getCurrentDateTime(),
        createdAt: getCurrentDateTime(),
        indexerDID: didSession.did?.parent,
    };

    const { data, errors } = await composeClient.executeQuery(`
                mutation CreateIndexLink($input: CreateIndexLinkInput!) {
                    createIndexLink(input: $input) {
                        document {
                            id
                            indexerDID {
                                id
                            }
                            controllerDID {
                                id
                            }
                            indexId
                            linkId
                            createdAt
                            updatedAt
                            deletedAt
                            link {
                                id
                                controllerDID {
                                    id
                                }
                                title
                                url
                                favicon
                                tags
                                content
                                createdAt
                                updatedAt
                                deletedAt
                            }
                        }
                    }
                }`, { input: {
                    content: indexLink,
                } });

    if (errors) {
        // TODO Handle
    }
    return data?.createIndexLink.document;
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
                  ${indexFragment}                    
                }
          }`
        })
    })

    let res = await results.json();
    let index = res.data.node;

    if(!index){
        return false;
    }

    if (index.links.edges.length > 0 && (moment(index.links.edges[0].node.updatedAt) > moment(index.updatedAt))) {
        index.updatedAt = index.links.edges[0].node.updatedAt;
    }

    delete index.links;

    index.ownerDID = await getOwnerProfile(index.pkpPublicKey);

    return index;
}
