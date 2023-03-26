const moment = require("moment");
const _ = require('lodash')

const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: process.env.ELASTIC_HOST })

const RedisClient = require('../clients/redis.js');
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
                            field: "deleted_at",
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
                    includes: ["index.updated_at"],
                },
                sort: [{
                    "index.updated_at": {"order": "desc"}
                }]
            },{
                name: "latest_link",
                size: 1,
                _source: {
                    includes: ["updated_at"],
                },
                sort: [{
                    "updated_at": {"order": "desc"}
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
            "index.created_at": {
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
                                field: "deleted_at",
                            },
                        },
                        {
                            exists: {
                                field: "link.deleted_at",
                            },
                        },
                    ],

                },
            },
            /*
            aggs: {
                max_updated_at: {
                    max: {
                        field: "updated_at"
                    }
                },
                max_created_at: {
                    max: {
                        field: "created_at"
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
                max_analyzed_offset: 2000,
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
                created_at: {
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

            let index_updated = h.inner_hits.latest_index.hits.hits[0]._source.index.updated_at;
            let link_updated = h.inner_hits.latest_link.hits.hits[0]._source.updated_at || 0;
            h._source.index.updated_at = moment(index_updated) > moment(link_updated) ? index_updated : link_updated

            let mapped = {
                ...h._source?.index
            }
            if(hasSearchTerm){
                mapped.highlight= h.highlight;
                mapped.links= h.inner_hits?.links?.hits?.hits?.map((ih) => (
                    {
                        ..._.omit(ih._source, "index"),
                        highlight: ih.highlight,
                    }
                ));
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

        index.is_in_my_indexes = false;
        index.is_starred = false;

        if(user_indexes_by_type.my_indexes && user_indexes_by_type.my_indexes.length > 0){
            index.is_in_my_indexes = !!user_indexes_by_type.my_indexes.filter(ui => ui.index_id == index.id && ui.type == 'my_indexes').length;
        }
        if(user_indexes_by_type.starred && user_indexes_by_type.starred.length > 0){
            index.is_starred = !!user_indexes_by_type.starred.filter(ui => ui.index_id == index.id && ui.type == 'starred').length;
        }
        return index
    })

    let pkpOwners = await redis.hmGet(`pkp:owner`, indexResult.map(index => index.controller_did.id.toLowerCase()))
    indexResult = indexResult.map((value, key) => {
        return {
            ...value,
            owner_did: {
                id: pkpOwners[key]
            }
        }
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

exports.did = async (req, res) => {

    const {did, type, search, skip, take, links_size} = req.body;

    let user_indexes = await redis.hGetAll(`user_indexes:by_did:${did.toLowerCase()}`)


    user_indexes_by_type = _.chain(user_indexes)
                            .map(i => JSON.parse(i))
                            .filter(i => !i.deleted_at)
                            .groupBy("type")
                            .value()
    if(type){
        let search_result = {};
        search_result[type] = await indexesSearch(user_indexes_by_type[type].map(i => i.index_id), search, skip, take, links_size, user_indexes_by_type)
        res.json(search_result)
    }else{
        let search_result = _.mapValues(user_indexes_by_type, async (type_group, key) => {
            return indexesSearch(type_group.map(i => i.index_id), search, skip, take, links_size, user_indexes_by_type)
        })
        search_result = await promiseAllOfObject(search_result);
        res.json(search_result)
    }


};

exports.index = async (req, res) => {

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

exports.link = async (req, res, next) => {

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

exports.user_index = async (req, res, next) => {

    const { did, index_id } = req.body;

    if(index_id){
        let my_indexes = await redis.hGet(`user_indexes:by_did:${did.toLowerCase()}`, `${index_id}:my_indexes`)
        let starred = await redis.hGet(`user_indexes:by_did:${did.toLowerCase()}`, `${index_id}:starred`)
        res.json({
            my_indexes: JSON.parse(my_indexes),
            starred: JSON.parse(starred),
        })
    }

};
