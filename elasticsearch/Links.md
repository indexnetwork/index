## Links Index

To store the links of the indices.

### Mapping

```
{
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
  },
  "mappings": {
    "properties": {
      "content": {
        "type": "search_as_you_type",
        "analyzer": "searchable",
        "max_shingle_size": 3
      },
      "created_at": {
        "type": "date"
      },
      "id": {
        "type": "keyword"
      },
      "sort": {
        "type": "long"
      },
      "tags": {
        "type": "keyword",
        "analyzer": "searchable",        
      },
      "title": {
        "type": "search_as_you_type",
        "analyzer": "searchable",
        "max_shingle_size": 3
      },
      "topic_id": {
        "type": "keyword"
      },
      "updated_at": {
        "type": "date"
      },
      "url": {
        "type": "search_as_you_type",
        "analyzer": "searchable",
        "max_shingle_size": 3
      },
      "topic": {
        "type": "nested",
        "properties": {
          "cloned_from": {
            "type": "keyword"
          },
          "created_at": {
            "type": "date"
          },
          "id": {
            "type": "keyword"
          },
          "private_link_code": {
            "type": "keyword",
            "ignore_above": 256
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
          }
        }
      }
    }
  }
}
```


### Search On Links

```

```
