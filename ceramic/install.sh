rm -rf temp

composedb composite:create schemas/Index.graphql --output temp/index.json --did-private-key $(cat priv.key)
composedb composite:create schemas/Link.graphql --output temp/link.json --did-private-key $(cat priv.key)
composedb composite:create schemas/UserIndex.graphql --output temp/user_index.json --did-private-key $(cat priv.key)
composedb composite:create schemas/relations.graphql --output temp/relations.json --did-private-key $(cat priv.key)

composedb composite:merge temp/index.json temp/link.json temp/relations.json temp/user_index.json --output temp/merged.json
composedb composite:deploy temp/merged.json  --did-private-key $(cat priv.key)

composedb composite:compile temp/merged.json temp/merged-runtime.json
composedb composite:compile temp/merged.json temp/merged-runtime.js

composedb graphql:server --graphiql --port=35000 temp/merged-runtime.json --did-private-key=$(cat priv.key)
