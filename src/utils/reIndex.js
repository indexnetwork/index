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
  setTimeout(function(){
    start()
  },3000)
}

async function start() {
  try {
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
          "id": {
            "type": "keyword"
          },
          "index_id": {
            "type": "keyword"
          },
          "link_id": {
            "type": "keyword"
          },
          "indexer_did": {
            "properties": {
              "id": {
                "type" : "keyword"
              }
            }
          },
          "controller_did": {
            "properties": {
              "id": {
                "type" : "keyword"
              }
            }
          },
          "updated_at": {
            "type": "date"
          },
          "created_at": {
            "type": "date"
          },
          "deleted_at": {
            "type": "date"
          },
          "link": {
            "properties": {
              "id": {
                "type": "keyword"
              },
              "controller_did": {
                "properties": {
                  "id": {
                    "type" : "keyword"
                  }
                }
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
              "favicon": {
                "type": "keyword"
              },
              "tags": {
                "type": "search_as_you_type",
                "analyzer": "searchable",
              },
              "content": {
                "type": "search_as_you_type",
                "analyzer": "searchable",
                "max_shingle_size": 3
              },
              "created_at": {
                "type": "date"
              },
              "updated_at": {
                "type": "date"
              },
              "deleted_at": {
                "type": "date"
              },
            }
          },
          "index": {
            "properties": {
              "id": {
                "type": "keyword"
              },
              "controller_did": {
                "properties": {
                  "id": {
                    "type" : "keyword"
                  }
                }
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
              "deleted_at": {
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

reset()
