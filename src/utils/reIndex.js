const { Client } = require('@elastic/elasticsearch')
const searchClient = require('../services/elastic')
const client = new Client({ node: process.env.ELASTIC_HOST })

const db = require('../models')
module.exports = reIndex = async () => {
  try {

    let exists = await client.indices.exists({
      index: 'links'
    })
    if(exists){
      await client.indices.delete({
        index: 'links',
      })
    }

    await client.indices.create({
      index: 'links',
      body: {
        settings: {
          "index": {
            "number_of_shards": "1",
            "analysis": {
              "filter": {
                "custom_ascii_folding": {
                  "type": "asciifolding",
                  "preserve_original": "true"
                }
              },
              "analyzer": {
                "searchable": {
                  "filter": [
                    "lowercase",
                    "custom_ascii_folding"
                  ],
                  "tokenizer": "standard"
                }
              }
            },
            "number_of_replicas": "0"
          }
        }
      },
    })

    await client.indices.putMapping({
      "index": 'links',
      "body": {
          "properties": {
            "content": {
              "type": "search_as_you_type",
              "analyzer": "searchable",
              "max_shingle_size": 3
            },
            "title": {
              "type": "search_as_you_type",
              "analyzer": "searchable",
              "max_shingle_size": 3
            },
            "description": {
              "type": "search_as_you_type",
              "analyzer": "searchable",
              "max_shingle_size": 3
            },            
            "url": {
              "type": "search_as_you_type",
              "analyzer": "searchable",
              "max_shingle_size": 3
            },
            "tags": {
              "type": "search_as_you_type",
              "analyzer": "searchable",
            },            
            "sort": {
              "type": "long"
            },
            "language": {
              "type": "keyword"
            },
            "id": {
              "type": "keyword"
            },
            "topic_id": {
              "type": "keyword"
            },
            "created_at": {
              "type": "date"
            },            
            "updated_at": {
              "type": "date"
            },
            "topic": {
              "properties": {
                "id": {
                  "type": "keyword"
                },
                "cloned_from": {
                  "type": "keyword"
                },                
                "public_rights": {
                  "type": "keyword"
                },
                "roles": {
                  "type": "keyword"
                },          
                "slug": {
                  "type": "keyword"
                },
                "title": {
                  "type": "search_as_you_type",
                  "analyzer": "searchable",
                  "max_shingle_size": 3
                },
                "updated_at": {
                  "type": "date"
                },
                "created_at": {
                  "type": "date"
                },
              }
            }
          }
        },      
    })
  } catch (err) {
    console.log(err.meta.body)
  }

  let topics = await db.topics
  .findAll({
    include: [
      { model: db.links },
      { model: db.users },
      { model: db.invitations },
    ],
  })

  for (let topic of topics) {
     await searchClient.indexTopic(topic)
     await searchClient.indexLinks(topic, topic.links)
  }
}
