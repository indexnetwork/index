import dotenv from 'dotenv'
import axios from 'axios'

if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}

import { Client } from '@elastic/elasticsearch'

const client = new Client({ node: process.env.ELASTIC_HOST })


import {getIndexLinkById, getLinkById} from "./composedb.js";

const config = {
    indexName: 'links'
}


export const createIndexLink = async (indexLinkId) => {
    console.log("createIndexLink", indexLinkId)
    let indexLink = await getIndexLinkById(indexLinkId)

    try {
        await axios.post(`http://llm-indexer.testnet/index/${indexLink.indexId}/links`, {url: indexLink.link.url})
    } catch (e) {
        console.log("Indexer error:", e.message);
    }
    delete indexLink.link.content // TODO fix stored in the indexer only, for now.
    indexLink.link.url_exact_match = indexLink.link.url;
    await client.update({
        index: config.indexName,
        id: indexLink.id,
        refresh: true,
        doc_as_upsert: true,
        doc: indexLink,
    })
}
export const updateIndexLink = async (indexLinkId) => {

    console.log("updateIndexLink", indexLinkId)

    let indexLink = await getIndexLinkById(indexLinkId)
    delete indexLink.link.content  // TODO fix stored in the indexer only, for now.
    indexLink.link.url_exact_match = indexLink.link.url;
    await client.update({
        index: config.indexName,
        id: indexLink.id,
        refresh: true,
        doc_as_upsert: true,
        doc: indexLink
    })
}

export const createLink = async (link) => {
    console.log("createLink - Ignore", link)
}

export const updateLink = async (linkId) => {

    console.log("updateLink", linkId)
    const link = await getLinkById(linkId)
    delete link.content
    link.url_exact_match = link.url;
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

export const updateLinkContent = async (url, content) => {

    console.log("updateLinkContent", url, content)

    await client.updateByQuery({
        index: config.indexName,
        refresh: true,
        conflicts: "proceed",
        script: {
            lang: 'painless',
            source: 'ctx._source.link.content = params.content',
            params: {
                content
            }
        },
        query: {
            bool: {
                must: [
                    {
                        term: {
                            "link.url_exact_match": url
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

