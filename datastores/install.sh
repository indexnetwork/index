helm upgrade --install kafka bitnami/kafka --values values-kafka.yaml
helm upgrade --install kowl cloudhut/kowl --values values-kowl.yaml
helm upgrade --install postgresql stable/postgresql --values values-postgresql.yaml
helm upgrade --install elasticsearch bitnami/elasticsearch --values values-elasticsearch.yaml 
helm upgrade --install redis bitnami/redis --values values-redis.yaml
kubectl apply -f kafkaconnect.yaml

curl -X DELETE \
  http://kafkaconnect-service.composedb:8083/connectors/containers-connector-final-running-3


curl -X POST \
  http://kafkaconnect-service.composedb:8083/connectors \
  -H 'Content-Type: application/json' \
  -d @connector.json


curl -X PUT \
  http://kafkaconnect-service.composedb:8083/connectors/containers-connector/config \
  -H 'Content-Type: application/json' \
  -d 


 kubectl run -it --rm debezium-ui --env KAFKA_CONNECT_URIS=http://kafkaconnect-service:8083 --image debezium/debezium-ui:latest
