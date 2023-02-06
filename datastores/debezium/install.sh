aws ecr get-login-password --region us-east-1 --profile i | docker login --username AWS --password-stdin 534970752686.dkr.ecr.us-east-1.amazonaws.com
docker build  --platform=linux/amd64 -t debezium-connect .
docker tag debezium-connect  534970752686.dkr.ecr.us-east-1.amazonaws.com/debezium-connect:2.1
docker push 534970752686.dkr.ecr.us-east-1.amazonaws.com/debezium-connect:2.1
kubectl delete -f kafkaconnect.yaml
kubectl apply -f kafkaconnect.yaml