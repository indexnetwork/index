rm -rf temp

DID_PRIVATE_KEY=$(cat ./conf/priv.key)
CERAMIC_URL=http://localhost:7007


composedb composite:create ./conf/schema/0-BasicProfile.graphql --output ./temp/basic-profile.json --did-private-key $DID_PRIVATE_KEY -c=$CERAMIC_URL

composedb composite:create ./conf/schema/1-Index.graphql --output ./temp/index.json --did-private-key $DID_PRIVATE_KEY -c=$CERAMIC_URL
composedb composite:create ./conf/schema/2-UserIndex.graphql --output ./temp/user-index.json --did-private-key $DID_PRIVATE_KEY -c=$CERAMIC_URL

composedb composite:create ./conf/schema/3.1-Link.graphql --output ./temp/link.json --did-private-key $DID_PRIVATE_KEY -c=$CERAMIC_URL
composedb composite:create ./conf/schema/4.1-IndexLink.graphql --output ./temp/index-record.json --did-private-key $DID_PRIVATE_KEY -c=$CERAMIC_URL
composedb composite:create ./conf/schema/4.2-IndexLink-reverse.graphql --output ./temp/index-record-reversed.json --did-private-key $DID_PRIVATE_KEY -c=$CERAMIC_URL

composedb composite:merge ./temp/basic-profile.json \
  ./temp/index.json \
  ./temp/user-index.json \
  ./temp/link.json \
  ./temp/index-record.json \
  ./temp/index-record-reversed.json \
  --output ./temp/merged.json  --did-private-key $DID_PRIVATE_KEY -c=$CERAMIC_URL

composedb composite:deploy ./temp/merged.json --did-private-key $DID_PRIVATE_KEY -c=$CERAMIC_URL

kubectl run postgresql-client --rm --tty -i --restart='Never' --image docker.io/bitnami/postgresql \
 --env="PGPASSWORD=wGW9Ck4U7SKgkZjGMqtnab9Q" \
 --command -- psql --host postgresql -U postgres -d composedb -p 5432 -c \
 'ALTER TABLE kjzl6hvfrbw6c732vo3usihwsmaudk78by48c6fy7qxxwkmn9yrryza13jyg6kt REPLICA IDENTITY FULL;
	ALTER TABLE kjzl6hvfrbw6c8mi3r321zv8aujo0pz75u3hd75nmnw8cohfakz650td4c7qxxf REPLICA IDENTITY FULL;
	ALTER TABLE kjzl6hvfrbw6c9uhr6wtbziqokgadeavvh1y9u7qbs6u3jmwz7nmxexwb0mgj52 REPLICA IDENTITY FULL;'

composedb composite:compile ./temp/merged.json ./temp/merged-runtime.json -c=$CERAMIC_URL
composedb composite:compile ./temp/merged.json ./temp/merged-runtime.js -c=$CERAMIC_URL

# kubectl delete configmap composedb-client-config
# kubectl create configmap composedb-client-config --from-file temp/merged-runtime.json --from-file composedb.config.json
# kubectl rollout restart deployment/composedb-client

#--did-private-key=$(COMPOSEDB_PRIVATE_KEY)

