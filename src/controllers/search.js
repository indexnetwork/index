const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: process.env.ELASTIC_HOST })
const _ = require('lodash')
const config = {
    indexName: 'links'
}

const indexesWithLinksQuery = (
    index_ids,
    req = {
        skip: 0,
        take: 10,
    },
    linksSize = 3
    ) => {
    const search = {
        index: config.indexName,
        from: req.skip,
        size: req.take,
        _source_excludes: ["content"],
        query: {
            bool: {
                must: [
                    {
                        terms: { "index_id": index_ids },
                    }
                ],
            },
        },
        collapse: {
            field: "index_id",
        },
        aggs: {
            totalCount: {
                cardinality: {
                    field: "index_id",
                },
            },
        },
    };

    if (req.search) {
        (search.query?.bool?.must).push({
            bool: {
                minimum_should_match: 1,
                should: [
                    {
                        multi_match: {
                            fields: ["title^10", "url", "content", "index.title"],
                            analyzer: "searchable",
                            query: req.search,
                            type: "phrase_prefix",
                            slop: 1,
                            zero_terms_query: "all",
                        },
                    },
                    {
                        multi_match: {
                            fields: ["tags^3"],
                            analyzer: "searchable",
                            query: req.search,
                            type: "bool_prefix",
                            zero_terms_query: "all",
                        },
                    },
                ],
            },
        });

        search.collapse.inner_hits = {
            name: "links",
            size: linksSize,
            _source: {
                excludes: ["content"],
            },
            highlight: {
                type: "plain",
                fields: {
                    title: {
                        number_of_fragments: 0,
                    },
                    url: {
                        number_of_fragments: 0,
                    },
                    "index.title": {
                        number_of_fragments: 0,
                    },
                    content: {
                        fragment_size: 200,
                        number_of_fragments: 2,
                    },
                },
            },
        };
    } else {
        search._source_includes = ["index"];
        search.sort = {
            "index.created_at": {
                order: "desc",
            },
        };
    }
    return search;
};


const linksQuery = (
        index_id,
        req= {
            skip: 0,
            take: 10,
        },
    ) => {
        const search = {
            index: config.indexName,
            from: req.skip,
            size: req.take,
            _source_excludes: ["content", "index"],
            query: {
                bool: {
                    must: [
                        {
                            term: { index_id },
                        },
                        {
                            exists: {
                                field: "id",
                            },
                        }
                    ],
                },
            },
        };

        if (req.search) {
            (search.query?.bool?.must).push({
                bool: {
                    minimum_should_match: 1,
                    should: [
                        {
                            multi_match: {
                                fields: ["title^10", "url", "content"],
                                analyzer: "searchable",
                                query: req.search,
                                type: "phrase_prefix",
                                slop: 1,
                                zero_terms_query: "all",
                            },
                        },
                        {
                            multi_match: {
                                fields: ["tags^3"],
                                analyzer: "searchable",
                                query: req.search,
                                type: "bool_prefix",
                                zero_terms_query: "all",
                            },
                        },
                    ],
                },
            });

            search.highlight = {
                type: "plain",
                fields: {
                    title: {
                        number_of_fragments: 0,
                    },
                    url: {
                        number_of_fragments: 0,
                    },
                    content: {
                        fragment_size: 200,
                        number_of_fragments: 2,
                    },
                },
            };
        } else {
            search.sort = {
                sort: {
                    order: "asc",
                },
            };
        }

        return search;
    };


const transformIndexSearch = (
    dt,
    hasSearchTerm,
) => {
    let result = [];

    const hits = dt?.hits?.hits;
    if (hits && hits.length > 0) {
        if (hasSearchTerm) {
            hits.forEach((h) => {
                console.log(h._source)
                const indexResponse = {
                    ...h._source?.index,
                    highlight: h.highlight,
                    links: h.inner_hits?.links?.hits?.hits?.map((ih) => (
                        {
                            ..._.omit(ih._source, "index"),
                            highlight: ih.highlight,
                        }
            )),
            };
                result.push(indexResponse);
            });
        } else {
            result = hits.map((h) => h._source?.index);
        }
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
            return hits.map((h) => (
                {
                    ...h._source,
                    highlight: h.highlight,
                }
            ));
        }
        return hits.map((h) => h._source);
    }
    return result;
}


exports.index = async (req, res, next) => {

    let reqParam = {skip:0, take: 10, search: 'link'}

    const query = indexesWithLinksQuery(['kjzl6kcym7w8y9qkco9t53p73xk4iuc3mtxsqlg3ea3rbk2jjxvromhwbgt151n'], reqParam, 3);
    const result = await client.search(query);


    const totalCount = result.aggregations?.totalCount?.value || 0;

    const indexResult = transformIndexSearch(result, (reqParam.search != null && !!reqParam.search));

    const response = {
        totalCount,
        records: indexResult,
    };
    res.json(response)
    /*
    const totalCount = (result?.hits?.total as any)?.value || 0;

    const response: IndexSearchResponse = {
        totalCount,
        records: this.transformIndexSearch(result, !!req.search),
        search: req,
    };
     */
};

exports.link = function(req, res, next){

};

