import dotenv from "dotenv";
if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}

import moment from "moment";
import _ from 'lodash';

import { Client } from '@elastic/elasticsearch'
import RedisClient from '../clients/redis.js';
import { sendLit } from '../packages/faucet.js';



const client = new Client({ node: process.env.ELASTIC_HOST })
const redis = RedisClient.getInstance();

const config = {
    indexName: 'links'
}

const indexesWithLinksQuery = (
    index_ids,
    search=false,
    skip= 0,
    take= 10,
    links_size= 3
    ) => {
    const params = {
        index: config.indexName,
        from: skip,
        size: take,
        _source_excludes: ["link.content"],
        query: {
            bool: {
                must: [
                    {
                        terms: { "index.id": index_ids },
                    }
                ],
                must_not: [
                    {
                        exists: {
                            field: "deletedAt",
                        },
                    },
                ],
            },
        },
        collapse: {
            field: "index.id",
            max_concurrent_group_searches: 20,
            inner_hits: [{
                name: "latest_index",
                size: 1,
                _source: {
                    includes: ["index.updatedAt"],
                },
                sort: [{
                    "index.updatedAt": {"order": "desc"}
                }]
            },{
                name: "latest_link",
                size: 1,
                _source: {
                    includes: ["updatedAt"],
                },
                sort: [{
                    "updatedAt": {"order": "desc"}
                }]
            }]
        },
        aggs: {
            totalCount: {
                cardinality: {
                    field: "index.id",
                },
            },
        },
    };

    if (search) {
        (params.query?.bool?.must).push({
            bool: {
                minimum_should_match: 1,
                should: [
                    {
                        multi_match: {
                            fields: ["link.title^10", "link.url", "link.content", "index.title"],
                            analyzer: "searchable",
                            query: search,
                            type: "phrase_prefix",
                            slop: 1,
                            zero_terms_query: "all",
                        },
                    },
                    {
                        multi_match: {
                            fields: ["link.tags^3"],
                            analyzer: "searchable",
                            query: search,
                            type: "bool_prefix",
                            zero_terms_query: "all",
                        },
                    },
                ],
            },
        });

        params.collapse.inner_hits.push({
            name: "links",
            size: links_size,
            _source: {
                excludes: ["link.content"],
            },
            highlight: {
                fields: {
                    "index.title": {
                        number_of_fragments: 0,
                    },
                    "link.title": {
                        number_of_fragments: 0,
                    },
                    "link.url": {
                        number_of_fragments: 0,
                    },
                    "link.content": {
                        fragment_size: 256,
                        number_of_fragments: 2,
                    },
                },
            },
        });
    } else {
        params._source_includes = ["index"];
        params.sort = {
            "index.createdAt": {
                order: "desc",
                missing: "_last"
            },
        };
    }

    return params;
};


const linksQuery = (
        index_id,
        search=false,
        skip=0,
        take=10,
    ) => {
        const params = {
            index: config.indexName,
            from: skip,
            size: take,
            _source_excludes: ["link.content", "index"],
            query: {
                bool: {
                    must: [
                        {
                            term: {
                                "index.id": index_id
                            },
                        },
                        {
                            exists: {
                                field: "id",
                            },
                        },
                    ],
                    must_not: [
                        {
                            exists: {
                                field: "deletedAt",
                            },
                        },
                        {
                            exists: {
                                field: "link.deletedAt",
                            },
                        },
                    ],

                },
            },
            /*
            aggs: {
                max_updatedAt: {
                    max: {
                        field: "updatedAt"
                    }
                },
                max_createdAt: {
                    max: {
                        field: "createdAt"
                    }
                }
            }
            */
        };

        if (search) {
            (params.query?.bool?.must).push({
                bool: {
                    minimum_should_match: 1,
                    should: [
                        {
                            multi_match: {
                                fields: ["link.title^10", "link.url", "link.content"],
                                analyzer: "searchable",
                                query: search,
                                type: "phrase_prefix",
                                slop: 1,
                                zero_terms_query: "all",
                            },
                        },
                        {
                            multi_match: {
                                fields: ["link.tags^3"],
                                analyzer: "searchable",
                                query: search,
                                type: "bool_prefix",
                                zero_terms_query: "all",
                            },
                        },
                    ],
                },
            });

            params.highlight = {
                max_analyzed_offset: 20000,
                fields: {
                    "link.title": {
                        number_of_fragments: 0,
                    },
                    "link.url": {
                        number_of_fragments: 0,
                    },
                    "link.content": {
                        fragment_size: 256,
                        number_of_fragments: 2,
                    },
                },
            };
        } else {
            params.sort = {
                createdAt: {
                    order: "desc",
                    missing: "_last"
                },
            };
        }

        return params;
    };


const transformIndexSearch = (
    dt,
    hasSearchTerm,
) => {
    let result = [];

    const hits = dt?.hits?.hits;
    if (hits && hits.length > 0) {
        result = hits.map((h) => {

            let index_updated = h.inner_hits.latest_index.hits.hits[0]._source.index.updatedAt;
            let link_updated = h.inner_hits.latest_link.hits.hits[0]._source.updatedAt || 0;
            h._source.index.updatedAt = moment(index_updated) > moment(link_updated) ? index_updated : link_updated

            let mapped = {
                ...h._source?.index
            }
            if(hasSearchTerm){
                mapped.highlight = h.highlight;
                mapped.links= h.inner_hits?.links?.hits?.hits?.map((ih) => {
                    const mappedValues = Object.entries(ih.highlight).map(([key, value]) => [key, value.join("...")]);
                    const mappedObj = Object.fromEntries(mappedValues);
                    return {
                        ..._.omit(ih._source, "index"),
                        highlight: mappedObj,
                    };
                });
            }

            return mapped

        });

    }
    return result;
}

const transformLinkSearch = (
    dt,
    hasSearchTerm,
)  => {
    const result = [];

    const hits = dt?.hits?.hits;
    if (hits && hits.length > 0) {
        if (hasSearchTerm) {
            return hits.map((h) => {
                const mappedValues = Object.entries(h.highlight).map(([key, value]) => [key, value.join("...")]);
                const mappedObj = Object.fromEntries(mappedValues);

                return {
                    ...h._source,
                    highlight: mappedObj,
                }
            });
        }
        return hits.map((h) => h._source);
    }
    return result;
}

const indexesSearch = async (index_ids , search, skip, take, links_size, user_indexes_by_type) => {

    const query = indexesWithLinksQuery(index_ids, search, skip, take, links_size);
    const result = await client.search(query);

    const totalCount = result.aggregations?.totalCount?.value || 0;

    let indexResult = transformIndexSearch(result, !!search);

    if(totalCount === 0){
        return {
            totalCount,
            records: []
        }
    }

    indexResult = indexResult.map(index => {

        index.isOwner = false;
        index.isStarred = false;

        if(user_indexes_by_type.owner && user_indexes_by_type.owner.length > 0){
            index.isOwner = !!user_indexes_by_type.owner.filter(ui => ui.indexId == index.id && ui.type == 'my_indexes').length;
        }
        if(user_indexes_by_type.starred && user_indexes_by_type.starred.length > 0){
            index.isStarred = !!user_indexes_by_type.starred.filter(ui => ui.indexId == index.id && ui.type == 'starred').length;
        }
        return index
    })

    let pkpOwners = await redis.hmGet(`pkp:owner`, indexResult.map(index => index.pkpPublicKey.toLowerCase()))
    let ownerProfiles = await redis.hmGet(`profiles`, pkpOwners.map(p => `did:pkh:eip155:175177:${p}`))

    indexResult = indexResult.map((value, key) => {
        if(ownerProfiles[key]){
            value.ownerDID = JSON.parse(ownerProfiles[key])
        }else{
            value.ownerDID = {
                id: `did:pkh:eip155:175177:${pkpOwners[key]}`
            }
        }
        return value
    })

    return {
        totalCount,
        records: indexResult,
    };
};

const promiseAllOfObject = async (obj) => {
  const values = await Promise.all(Object.values(obj));
  return Object.keys(obj).reduce(
    (res, key, index) => (res[key] = values[index], res),
    {}
  );
};

export const did = async (req, res) => {


    const {did, type, search, skip, take, links_size} = req.body;

    sendLit(did.split(":").pop());

    let user_indexes_res = await redis.hGetAll(`user_indexes:by_did:${did.toLowerCase()}`)

    let user_indexes = _.chain(user_indexes_res)
                            .map(i => JSON.parse(i))
                            .filter(i => !i.deletedAt)

    let user_indexes_by_type = user_indexes.groupBy("type").value()
    user_indexes_by_type["all_indexes"] = user_indexes.value();

    if(type){
        let search_result = {};
        search_result[type] = await indexesSearch(user_indexes_by_type[type].map(i => i.indexId), search, skip, take, links_size, user_indexes_by_type)
        res.json(search_result)
    }else{
        let search_result = _.mapValues(user_indexes_by_type, async (type_group, key) => {
            return indexesSearch(type_group.map(i => i.indexId), search, skip, take, links_size, user_indexes_by_type)
        })
        search_result = await promiseAllOfObject(search_result);
        res.json(search_result)
    }


};

export const index = async (req, res) => {

    const {index_ids, search, skip, take, links_size} = req.body;

    const query = indexesWithLinksQuery(index_ids, search, skip, take, links_size);
    const result = await client.search(query);

    const totalCount = result.aggregations?.totalCount?.value || 0;

    const indexResult = transformIndexSearch(result, !!search);

    const response = {
        totalCount,
        records: indexResult,
    };
    res.json(response)

};

export const link = async (req, res, next) => {

    const {index_id, search, skip, take} = req.body;
    const query = linksQuery(index_id, search, skip, take);
    const result = await client.search(query);

    const totalCount = result?.hits?.total.value

    const response = {
        totalCount,
        records: transformLinkSearch(result, !!search),
    };

    res.json(response)
};

export const user_index = async (req, res, next) => {

    const { did, index_id } = req.body;

    if(index_id){
        let owner = await redis.hGet(`user_indexes:by_did:${did.toLowerCase()}`, `${index_id}:my_indexes`)
        let starred = await redis.hGet(`user_indexes:by_did:${did.toLowerCase()}`, `${index_id}:starred`)
        res.json({
            owner: JSON.parse(owner),
            starred: JSON.parse(starred),
        })
    }

};
