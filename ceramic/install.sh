rm -rf temp

composedb composite:create schemas/Index.graphql --output temp/index.json --did-private-key $(cat priv.key)  -c=https://ceramic.index.as
composedb composite:create schemas/Link.graphql --output temp/link.json --did-private-key $(cat priv.key)  -c=https://ceramic.index.as
composedb composite:create schemas/relations.graphql --output temp/relations.json --did-private-key $(cat priv.key)  -c=https://ceramic.index.as
composedb composite:create schemas/UserIndex.graphql --output temp/user_index.json --did-private-key $(cat priv.key)  -c=https://ceramic.index.as
composedb composite:create schemas/IndexasProfile.graphql --output temp/indexas_profile.json --did-private-key $(cat priv.key)  -c=https://ceramic.index.as

composedb composite:merge temp/index.json temp/link.json temp/relations.json temp/user_index.json temp/indexas_profile.json --output temp/merged.json   -c=https://ceramic.index.as
composedb composite:deploy temp/merged.json  --did-private-key $(cat priv.key) -c=https://ceramic.index.as

composedb composite:compile temp/merged.json temp/merged-runtime.json  -c=https://ceramic.index.as
composedb composite:compile temp/merged.json temp/merged-runtime.js  -c=https://ceramic.index.as



kubectl delete configmap composedb-config
kubectl create configmap composedb-config --from-file temp/merged-runtime.json --from-file composedb.config.json
kubectl delete -f k8s-composedb.yaml
kubectl apply -f k8s-composedb.yaml

kubectl delete secret composedb-secret
kubectl create secret generic composedb-secret --from-file priv.key
kubectl apply -f k8s-ceramic.yaml

composedb graphql:server --graphiql --port=35000 temp/merged-runtime.json --did-private-key=$(cat priv.key)



ALTER TABLE kjzl6hvfrbw6c9uhr6wtbziqokgadeavvh1y9u7qbs6u3jmwz7nmxexwb0mgj52 REPLICA IDENTITY FULL;
