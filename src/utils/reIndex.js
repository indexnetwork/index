require('dotenv').config()
const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: process.env.ELASTIC_HOST })

async function reset() {
  let exists = await client.indices.exists({
    index: 'links'
  })
  console.log("exists", exists)
  if(exists){
    await client.indices.delete({
      index: 'links',
    })
  }
}

async function start() {
  try {
    await client.indices.create({
      index: 'links',
      body: {
        settings: {
          "index": {
            "highlight.max_analyzed_offset" : 60000000,
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
          "id": {
            "type": "keyword"
          },
          "controller_did": {
            "type": "keyword"
          },
          "indexer_did": {
            "type": "keyword"
          },
          "index_id": {
            "type": "keyword"
          },
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
          "url": {
            "type": "search_as_you_type",
            "analyzer": "searchable",
            "max_shingle_size": 3
          },
          "tags": {
            "type": "search_as_you_type",
            "analyzer": "searchable",
          },
          "created_at": {
            "type": "date"
          },
          "updated_at": {
            "type": "date"
          },
          "index": {
            "properties": {
              "id": {
                "type": "keyword"
              },
              "controller_did": {
                "type": "keyword",
              },
              "collab_action": {
                "type": "keyword",
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
}
//reset()
start()
