helm upgrade --install kafka bitnami/kafka --values ../deploy/datastores/kafka.yaml
helm upgrade --install postgresql stable/postgresql --values ../deploy/datastores/postgresql.yaml
helm upgrade --install elasticsearch bitnami/elasticsearch --values ../deploy/datastores/elasticsearch.yaml
helm upgrade --install redis bitnami/redis --values ../deploy/datastores/redis.yaml

kubectl apply -f ../deploy/datastores/kafkaconnect.yaml
kubectl apply -f ../deploy/datastores/ipfs.yaml
kubectl apply -f ../deploy/datastores/ceramic.yaml

curl -X DELETE \
  http://kafkaconnect-service.composedb:8083/connectors/containers-connector

curl -X POST \
  http://kafkaconnect-service.composedb:8083/connectors \
  -H 'Content-Type: application/json' \
  -d @../conf/kafka-postgres-connector.json
