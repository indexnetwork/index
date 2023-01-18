## Indexes

To store the indexes.

### Mapping

```
{
  "mappings": {
    "properties": {
      "cloned_from": {
        "type": "long"
      },
      "created_at": {
        "type": "date"
      },
      "id": {
        "type": "long"
      },
      "invitations": {
        "type": "nested",
        "properties": {
          "created_at": {
            "type": "date"
          },
          "id": {
            "type": "long"
          },
          "permission": {
            "type": "text",
            "fields": {
              "keyword": {
                "type": "keyword",
                "ignore_above": 256
              }
            }
          },
          "topic_id": {
            "type": "long"
          },
          "updated_at": {
            "type": "date"
          },
          "url": {
            "type": "text",
            "fields": {
              "keyword": {
                "type": "keyword",
                "ignore_above": 256
              }
            }
          }
        }
      },
      "private_link_code": {
        "type": "text",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 256
          }
        }
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
      "users": {
        "type": "nested",
        "properties": {
          "id": {
            "type": "long"
          },
          "name": {
            "type": "keyword",
            "ignore_above": 256
          },
          "profile_picture": {
            "type": "keyword",
            "ignore_above": 256
          },
          "role": {
            "type": "keyword",
            "ignore_above": 256
          },
          "user_id": {
            "type": "long"
          },
          "username": {
            "type": "keyword",
            "ignore_above": 256
          },
          "visibility": {
            "type": "boolean"
          }
        }
      }
    }
  },
  "settings": {
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
      "number_of_replicas": "1"
    }
  }
}
```


### Search On Indexes

```
...
