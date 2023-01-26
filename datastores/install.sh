helm upgrade --install kafka bitnami/kafka --values values-kafka.yaml
helm upgrade --install kowl cloudhut/kowl --values values-kowl.yaml
helm upgrade --install postgresql stable/postgresql --values values-postgresql.yaml
helm upgrade --install elasticsearch -f values-elasticsearch.yaml bitnami/elasticsearch

kubectl apply -f kafkaconnect.yaml

curl -X DELETE \
  http://kafkaconnect-service.composedb:8083/connectors/containers-connector
curl -X POST \
  http://kafkaconnect-service.composedb:8083/connectors \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "containers-connector",
    "config": {
            "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
            "plugin.name": "pgoutput",
            "database.hostname": "postgresql",
            "database.port": "5432",
            "database.user": "postgres",
            "database.password": "wGW9Ck4U7SKgkZjGMqtnab9Q",
            "database.dbname": "composedb",
            "database.server.name": "postgres",
            "transforms": "unwrap",
            "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
            "transforms.unwrap.operation.header": "true",
            "transforms.unwrap.drop.tombstones": "true",
            "transforms.unwrap.delete.handling.mode" : "rewrite",
            "transforms.unwrap.add.fields": "table,lsn",
            "decimal.handling.mode": "string",
            "column.include.list": "public.kjzl6hvfrbw6c8olbhuzwqimo7mudyf6iui6wb1nlymjf57y16uufzogjd0cc5m.stream_id,public.kjzl6hvfrbw6c8olbhuzwqimo7mudyf6iui6wb1nlymjf57y16uufzogjd0cc5m.controller_did,public.kjzl6hvfrbw6c8olbhuzwqimo7mudyf6iui6wb1nlymjf57y16uufzogjd0cc5m.stream_content,public.kjzl6hvfrbw6c9nr6lquycvocpcpg7sxz55v67iyyv2n2t29tre8hy2gli4m6wn.stream_id,public.kjzl6hvfrbw6c9nr6lquycvocpcpg7sxz55v67iyyv2n2t29tre8hy2gli4m6wn.controller_did,public.kjzl6hvfrbw6c9nr6lquycvocpcpg7sxz55v67iyyv2n2t29tre8hy2gli4m6wn.stream_content",
            "key.converter": "org.apache.kafka.connect.json.JsonConverter",
            "key.converter.schemas.enable": "false",
            "value.converter": "org.apache.kafka.connect.json.JsonConverter",
            "value.converter.schemas.enable": "false"
      }
}'


curl -X PUT \
  http://kafkaconnect-service.composedb:8083/connectors/containers-connector/config \
  -H 'Content-Type: application/json' \
  -d '{
      "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
      "plugin.name": "pgoutput",
      "database.hostname": "postgresql",
      "database.port": "5432",
      "database.user": "postgres",
      "database.password": "wGW9Ck4U7SKgkZjGMqtnab9Q",
      "database.dbname": "composedb",
      "database.server.name": "postgres",
      "transforms": "unwrap",
      "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
      "transforms.unwrap.operation.header": "true",
      "transforms.unwrap.drop.tombstones": "true",
      "transforms.unwrap.delete.handling.mode" : "rewrite",
      "transforms.unwrap.add.fields": "table,lsn",
      "decimal.handling.mode": "string",
      "schema.include.list": "public",
      "key.converter": "org.apache.kafka.connect.json.JsonConverter",
      "key.converter.schemas.enable": "false",
      "value.converter": "org.apache.kafka.connect.json.JsonConverter",
      "value.converter.schemas.enable": "false"
}'

 kubectl run -it --rm debezium-ui --env KAFKA_CONNECT_URIS=http://kafkaconnect-service:8083 --image debezium/debezium-ui:latest
