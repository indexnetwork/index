cd ../conf
rm priv.key
rm pub.key
rm -rf generated

composedb did:generate-private-key >> priv.key
composedb did:from-private-key $(cat priv.key) > pub.key

export DID_PRIVATE_KEY=$(cat priv.key)

kubectl delete secret composedb-secret
kubectl create secret generic composedb-secret --from-file priv.key