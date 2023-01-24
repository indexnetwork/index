const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: process.env.ELASTIC_HOST })
const _ = require('lodash')
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

    if (search) {
        (params.query?.bool?.must).push({
            bool: {
                minimum_should_match: 1,
                should: [
                    {
                        multi_match: {
                            fields: ["title^10", "url", "content", "index.title"],
                            analyzer: "searchable",
                            query: search,
                            type: "phrase_prefix",
                            slop: 1,
                            zero_terms_query: "all",
                        },
                    },
                    {
                        multi_match: {
                            fields: ["tags^3"],
                            analyzer: "searchable",
                            query: search,
                            type: "bool_prefix",
                            zero_terms_query: "all",
                        },
                    },
                ],
            },
        });

        params.collapse.inner_hits = {
            name: "links",
            size: links_size,
            _source: {
                excludes: ["content"],
            },
            highlight: {
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
            _source_excludes: ["content", "index"],
            collapse: {
                field: "id",
            },
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

        if (search) {
            (params.query?.bool?.must).push({
                bool: {
                    minimum_should_match: 1,
                    should: [
                        {
                            multi_match: {
                                fields: ["title^10", "url", "content"],
                                analyzer: "searchable",
                                query: search,
                                type: "phrase_prefix",
                                slop: 1,
                                zero_terms_query: "all",
                            },
                        },
                        {
                            multi_match: {
                                fields: ["tags^3"],
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
                max_analyzed_offset: 20,
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


exports.index = async (req, res) => {

    let {index_ids, search, skip, take, links_size} = req.body;
    console.log(req.body)
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

    let {index_id, search, skip, take} = req.body;
    const query = linksQuery(index_id, search, skip, take);
    const result = await client.search(query);

    const totalCount = result?.hits?.hits &&
    result?.hits?.hits.length > 0 ? (result?.hits?.hits[0].inner_hits?.links.hits.total)?.value : 0;

    const response = {
        totalCount,
        records: transformLinkSearch(result, !!search),
    };

    res.json(response)
};

