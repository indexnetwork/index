const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: process.env.ELASTIC_HOST })
const _ = require('lodash')
const db = require('../models')
const indexName = 'links'

const highlightResult = (l) => {
  if (l.highlight) {
    if (l.highlight['content']) {
      l._source.content = l.highlight['content']
        .join('... ')
        .replace(/(\r\n|\n|\r|\\n)/gm, '')
    }
    if (l.highlight['title']) {
      l._source.title = l.highlight['title'][0]
    }

    if (l.highlight['url']) {
      l._source.url = l.highlight['url'][0]
    }

    if (l.highlight['tags']) {
      l._source.tags = l.highlight['tags']
    }

    if (l.highlight['topic.title']) {
      //Todo why zero?
      l._source.topic.title = l.highlight['topic.title']
    }
  }

  return l
}


const transformTopicsResult = (topics, q, offset, limit) => {
  
  let res = []
  let total = 0

  if(topics && topics.aggregations && topics.aggregations.top_topics){
    total = topics.aggregations.top_topics.buckets.length
    topics.aggregations.top_topics.buckets.forEach(b => {
      let topic = {}
      b.top_links.hits.hits.forEach(l => {
        
        l = highlightResult(l);
        
        if(!topic.id){
          topic = l._source.topic
          topic.links = []
        }
        let linkData = l._source
        if(linkData.url){
          delete linkData.topic
          topic.links.push(linkData)
        }

      })
      
      topic = db.topics.build(topic,{
        include: [
          { model: db.links },
          { model: db.users },
          { model: db.invitations },
        ]
      })

      res.push(topic)
    })  
  }

  return {topics: res, total: total}
}

const transformLinksResult = (links, q) => {


  let res = []

  if(links.hits){
    links.hits.forEach(l => {
      l = highlightResult(l)
      let linkData = l._source
      if(linkData.url){
        delete linkData.topic
        res.push(db.links.build(linkData))
      }
    })
  }

  return res

}

const search = async (query, multi) => {
  if (multi) {
    const { body } = await client.msearch(query)
    return body.responses
  } else {
    let { body } = await client.search({
      index: indexName,
      body: query,
    })
    return body.hits
  }
}


const transformTopic = (topic) => {

  if(!topic.users || typeof topic.users == 'array'){
    console.log(`Malformed index: ${topic.id}`)
    return false
  }

  let doc = {
    topic_id: topic.id,
    topic: topic.dataValues,
  }
  console.log(topic.id)
  delete doc.topic.links;
  doc.topic.roles =  topic.users.map((u) => `${u.id}-${u.user_topics.role}`)
  
  //console.log(doc)
  return doc

}

const transformLink = (link, topic) => {
  
  let doc = link.dataValues
  
  if(topic){
    let topicValues = transformTopic(topic);
    if(!topicValues){
      console.log("Noooo!")
      return false
    }
    doc = {...doc, ...topicValues}
  }

  return doc
  
}
//Test
const indexTopic = async (topic) => {
  let doc = transformTopic(topic)
  if(!doc){
    return false
  }
  await client.index({
    index: indexName,
    id: `topic-${topic.id}`,
    refresh: true,
    body: doc,
  })
}

//Test
const updateTopic = async (topic) => {

  try {

    await client.updateByQuery({
      index: indexName,
      refresh: true,
      body: {
          script: {
            lang: 'painless',
            params: transformTopic(topic),
            source: 'ctx._source.topic = params.topic',
          },
          query: {
              term: {
                  topic_id: topic.id
              }
          }
      }
    })

  } catch (e) {
    console.log(JSON.stringify(e))
  }
}

//Test
const removeTopic = async (id) => {
  await client.deleteByQuery({
    index: indexName,
    refresh: true,
    body: {
      query: {
          term: {
              topic_id: topic.id
          }
      }
    }    
  })
}


const removeLink = async (link_id) => {
  await client.delete({
    index: indexName,
    refresh: true,
    id: link_id
  })
}

const updateLink = async (link) => {

  try {

    await client.update({
      index: indexName,
      id: link.id,
      refresh: true,
      body: {
        doc: transformLink(link)
      }
    })

  } catch (e) {
    console.log(JSON.stringify(e))
  }
}

const updateLinks = async (links) => {
  const body = links.flatMap(link => [{ update: { _index: indexName, _id: link.id } }, {doc: transformLink(link)}])
  const { body: bulkResponse } = await client.bulk({ refresh: true, body })  
}

//Test
const indexLinks = async (topic, links) => {
  
  if(!links && typeof links !== 'array'){
    console.log(`Empty topic: ${topic.id}`)  
    return false
  }
  const body = links
    .map(l => transformLink(l, topic))
    .filter(l => Boolean)
    .flatMap(link => [{ index: { _index: indexName, _id: link.id } }, link])
  
  if(body.length > 0){
    const { body: bulkResponse } = await client.bulk({ refresh: true, body })  
  }

}


const roleQuery = (userId, roles) => ({
  terms: {
    'topic.roles': roles.map((r) => `${userId}-${r}`),
  },
})

const privacyQuery = (roles) => ({
  terms: {
    'topic.public_rights': roles
  },
})

const tagFilter = (tags) => ({
  terms: {
    'tags': tags
  },  
})

const linkSearchQuery = (topicId, requesterId, q, tags) => {
  let queryObject = {
    query: {
      bool: {
        must: [
          {
            multi_match: {
              fields: ['title^10', 'tags^3', 'url', 'content'],
              query: q,
              zero_terms_query: 'all',
            },
          },
          {
            term: {
              topic_id: topicId,
            }
          },
          {
            bool: {
              should: [privacyQuery(['view', 'edit'])],
              minimum_should_match: 1,
            },
          },
        ],
      },
    },
    highlight: highlighterSpec()
  }


  if (requesterId) {
    queryObject.query.bool.must[2].bool.should.push(
      roleQuery(requesterId, ['edit', 'owner', 'view'])
    )
  }

  //Todo check.
  if (tags) {
    queryObject.query.bool.must.push(tagFilter(tags))
  }
  console.log(JSON.stringify(queryObject))
  return queryObject
}


const topicSearchQuery = (q) => {
  return {
    bool: {
      minimum_should_match: 1,
      should: [
        {
          multi_match: {
            fields: ['title^10', 'url', 'content'],
            query: q,
            zero_terms_query: 'all',
          },
        },
        {
          multi_match: {
            fields: ['tags^5'],
            query: q,
            zero_terms_query: 'all',
          },
        },
        {
          bool: {
            must: [
              {
                multi_match: {
                  fields: ['topic.title^20'],
                  query: q,
                  zero_terms_query: 'all',
                }
              }
            ],
            must_not: [
              {
                exists: {
                  field: 'url'
                }
              }
            ]
          }
        }
      ],
    },
  }

}
/*
const getTopicAggregationSpec = (after) => {
  let agg = {
    "total_topics": {
      "cardinality" : { "field" : "topic_id" }
    },
    "top_topics":{
       "composite":{
          "size": 10,
          "sources":[{
              "topics": {
                "terms": {
                   "field": "topic_id"
                }
              }
          }]
       },
       "aggs":{
          "top_links":{
            "top_hits":{
              "size": 4,
              "_source":{
                 "exclude":[
                    "content"
                 ]
              },
            "highlight": highlighterSpec(),
          }
        }
      }        
    }
  }
  if(after){
    agg.top_topics.composite.after.topics = after
  }
}
*/

const getTopicAggregationSpec = () => {
  return {
    "top_topics": {
      "terms": {
        "field": "topic_id",
        "size": 10000
      },
      "aggs": {
        "top_links": {
          "top_hits": {
            "size": 4,
            "highlight": highlighterSpec(),
            "_source": {
              "exclude": [ "content" ]
            }
          }
        }
      }
    }
  }
}

const ownedSearchQuery = (userId, q) => {
  let queryObject = {
    query: {
      bool: {
        must: [
          topicSearchQuery(q),
          roleQuery(userId, ['owner'])
        ],
      },
    },
    aggs: getTopicAggregationSpec()
  }
  if (!q)
    queryObject.sort = {
      updated_at: {
        order: 'desc',
      },
    }

  return queryObject
}

const sharedSearchQuery = (userId, q) => {
  let queryObject = {
    query: {
      bool: {
        must: [
          topicSearchQuery(q),
          roleQuery(userId, ['view', 'edit'])
        ],
      },
    },
    aggs: getTopicAggregationSpec()
  }
  if (!q)
    queryObject.sort = {
      updated_at: {
        order: 'desc',
      },
    }

  return queryObject
}

const profileSearchQuery = (userId, q) => {
  let queryObject = {
    query: {
      bool: {
        must: [
          topicSearchQuery(q),
          roleQuery(userId, ['owner']),
        ]
      },
    },
    aggs: getTopicAggregationSpec()
  }

  if (!q)
    queryObject.sort = {
      updated_at: {
        order: 'desc',
      },
    }

  return queryObject
}


const highlighterSpec = () => {
  return {
    type: 'plain',
    fields: {
      'topic.title': {
        number_of_fragments: 0,
      },
      'title': {
        number_of_fragments: 0,
      },
      'url': {
        number_of_fragments: 0,
      },
      'tags': {
        number_of_fragments: 0,
      },
      'content': {
        fragment_size: 200,
        number_of_fragments: 2,
      },                        
    },
  }
}

const linkSearch = async (query, requester, topic) => {
  if (process.env.NODE_ENV !== 'test')
    console.log(['linksearch', query, requester, topic])
  query = linkSearchQuery(topic.id, requester, query, null)
  query.from = 0
  query.size = 10000
  query._source = {
    excludes: ['content'],
  }
  let links = await search(query, null)
  links = transformLinksResult(links, query)
  if (links) {
    return links
  } else {
    return []
  }
}

const profileSearch = async (user, q, offset, limit) => {
  if (process.env.NODE_ENV !== 'test')
    console.log(['profileSearch', user, q, offset, limit])
  query = profileSearchQuery(user, q)
  query.size = 0

  let topics = await search(query, null)
  return transformTopicsResult(topics, q, offset, limit)
}

const homeSearch = async (user, q, offset, limit) => {
  if (process.env.NODE_ENV !== 'test')
    console.log(['homeSearch', user, q, offset, limit])
  owned = ownedSearchQuery(user, q)
  owned.size = 0

  shared = sharedSearchQuery(user, q)
  shared.size = 0

  let queries = {
    body: [{ index: 'links' }, owned, { index: 'links' }, shared],
  }

  topics = await search(queries, true)
  let data = {
    topics: []
  }
  let set = []

  
  let r1 = transformTopicsResult(topics[0], q, offset, limit)
  data[q ? 'searchOwnedTopics' : 'ownedTopics'] = r1.total
  set.push(r1.topics)
  
  let r2 = transformTopicsResult(topics[1], q, offset, limit)
  data[q ? 'searchSharedTopics' : 'sharedTopics'] = r2.total
  set.push(r2.topics)


  data.topics = set.flat()

  return data
}

const ownedSearch = async (user, q, offset, limit) => {
  if (process.env.NODE_ENV !== 'test')
    console.log(['ownedSearch', user, q, offset, limit])

  query = ownedSearchQuery(user, q)
  query.size = 0
  topics = await search(query, null)

  let data = {}

  let r1 = transformTopicsResult(topics, q, offset, limit)
  data[q ? 'searchOwnedTopics' : 'ownedTopics'] = r1.total
  data.topics = r1.topics

}

const sharedSearch = async (user, q, offset, limit) => {
  if (process.env.NODE_ENV !== 'test')
    console.log(['sharedSearch', user, q, offset, limit])
  query = sharedSearchQuery(user, q)
  query.size = 0

  topics = await search(query, null)

  let data = {}

  let r1 = transformTopicsResult(topics, q, offset, limit)
  data[q ? 'searchSharedTopics' : 'sharedTopics'] = r1.total
  data.topics = r1.topics

  return data
}



module.exports = {
  indexTopic,
  updateTopic,
  removeTopic,

  indexLinks,
  updateLink,
  updateLinks,
  removeLink,

  linkSearch,
  profileSearch,
  homeSearch,
  ownedSearch,
  sharedSearch

}
