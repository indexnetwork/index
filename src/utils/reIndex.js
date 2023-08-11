import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
  dotenv.config()
}

import { Client } from '@elastic/elasticsearch'

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
          "indexId": {
            "type": "keyword"
          },
          "linkId": {
            "type": "keyword"
          },
          "indexerDID": {
            "properties": {
              "id": {
                "type" : "keyword"
              }
            }
          },
          "controllerDID": {
            "properties": {
              "id": {
                "type" : "keyword"
              }
            }
          },
          "updatedAt": {
            "type": "date"
          },
          "createdAt": {
            "type": "date"
          },
          "deletedAt": {
            "type": "date"
          },
          "link": {
            "properties": {
              "id": {
                "type": "keyword"
              },
              "controllerDID": {
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
              "url_exact_match": {
                "type": "keyword",
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
              "createdAt": {
                "type": "date"
              },
              "updatedAt": {
                "type": "date"
              },
              "deletedAt": {
                "type": "date"
              },
            }
          },
          "index": {
            "properties": {
              "id": {
                "type": "keyword"
              },
              "controllerDID": {
                "properties": {
                  "id": {
                    "type" : "keyword"
                  }
                }
              },
              "ownerDID": {
                "properties": {
                  "id": {
                    "type" : "keyword"
                  }
                }
              },
              "collabAction": {
                "type": "keyword",
              },
              "pkpPublicKey": {
                "type": "keyword",
              },
              "title": {
                "type": "search_as_you_type",
                "analyzer": "searchable",
                "max_shingle_size": 3
              },
              "updatedAt": {
                "type": "date"
              },
              "createdAt": {
                "type": "date"
              },
              "deletedAt": {
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
