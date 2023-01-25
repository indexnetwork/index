aws ecr get-login-password --region us-east-1 --profile i | docker login --username AWS --password-stdin 534970752686.dkr.ecr.us-east-1.amazonaws.com
docker build  --platform=linux/amd64 -t searcher .
docker tag searcher  534970752686.dkr.ecr.us-east-1.amazonaws.com/indexas-backend:0.0.4
docker push 534970752686.dkr.ecr.us-east-1.amazonaws.com/indexas-backend:0.0.4
kubectl scale deploy api --replicas=0
kubectl scale deploy api --replicas=1