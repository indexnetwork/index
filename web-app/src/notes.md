index.network : protocol, main product
index discovery: use case, client product

layout:

landinglayout:
  landingheader
  sections


discoverylayout:
  appheader
  appnav
  chat
  history


pages:

home: /
app: discovery/[did]: /app/discovery/pkh:eip155:175177:0xaf771BB037Ed40765EE7115aEF383145590ede8d
app: discovery/[index]: /app/discovery/kjzl6kcym7w8y737338pepoj26dthmmjngb3a4nvys7sbx909rtvvneygo1u59s


session & auth:

session: auth context
userDID: session.did.parent
id: params.id, discovery/[id], indexDID or DID


public:
view, chat

auth:
manipulate indexes
manipulate creators

not found did:
redirects to session user page


needed:
endpoint for: owner.DID of indexID: get from response

endpoint for: modify index: star:
- edit title: role owner : updateIndex()
- add/remove star: public : createDIDIndex({
    "indexId": "{{indexId}}",
    "type": "starred"
}) /dids/:did_id/indexes/:index_id/star
- add/remove to my profile: owner: createDIDIndex({
    "indexId": "{{indexId}}",
    "type": "owner"
}) /dids/:did_id/indexes/:index_id/own

endpoint for: modify index item
- add/remove from index
- search
