# Index Network Python SDK

Index is a discovery protocol that eliminates the need for intermediaries in finding knowledge, products, and like-minded people through direct, composable discovery across the web. As the first decentralized semantic index, it leverages Web3 and AI and offers an open layer for discovery.

You can either use the API directly or the client available. Here is a quick start to discover it.


## Using the Index Network Python SDK

The Index Network offers an SDK to facilitate various operations on the protocol. In this example, we'll demonstrate how to authenticate, create an Index, and add an Item to it.

> [**Index**](https://docs.index.network/docs/getting-started/data-models#index) is a fundamental component of the Index Network, designed to facilitate context management and enable semantic interoperability within your system. It serves as a structured way to organize and store data related to specific contexts.

> [**Item**](https://docs.index.network/docs/getting-started/data-models#indexitem) represents a graph node within an Index. It provides a standardized approach to representing and managing various types of data.

### Installation

First, install the indexnetwork-sdk package via pip:

```shell
pip install indexnetwork-sdk
```

Creating an Instance of IndexClient

```python
from indexclient import IndexClient

client = IndexClient(
    domain="index.network",
    wallet=your_wallet_object,  # Provide your wallet instance
    network="ethereum"  # Specify the network you're working on
)
```
For authentication, you need a `DIDSession`. You can either sign in using a wallet or pass an existing session. Check [Authentication](https://docs.index.network/docs/api-reference/identity/authentication) for details explanation on how to initiate a session.


```python
client.authenticate()
```

### Creating an Index

We're almost ready. Now, let's create an Index with a title.

```python
index_id = client.create_index("Future of publishing")
```

Great, now you have a truly decentralized index to interact with! Though it's empty, which means we need to create and add an [`Item`](https://docs.index.network/docs/api-reference/indexing/index) into it so we can interact. Let's do that.

```python
web_page = client.crawl_web_page("http://www.paulgraham.com/publishing.html")
client.add_item(index_id, web_page["id"])
```

### Using Custom Schemas
If you want to use your own schema, you can do so by creating and deploying a custom model. Below are the methods and examples of how to use them.

#### Creating a Custom Model
Use the createModel method to create a custom model using a GraphQL schema.

```python
graphQLSchema = """
type CustomObject {
    title: String! @string(maxLength: 50)
}

type YourModel @createModel(accountRelation: LIST, description: "Full schema for models") {
    id: ID!
    booleanValue: Boolean!
    intValue: Int!
    floatValue: Float!
    did: DID!
    streamId: StreamID!
    commitId: CommitID!
    cid: CID!
    chainId: ChainID!
    accountId: AccountID!
    uri: URI! @string(maxLength: 2000)
    date: Date!
    dateTime: DateTime!
    time: Time!
    localDate: LocalDate!
    localTime: LocalTime!
    timeZone: TimeZone!
    utcOffset: UTCOffset!
    duration: Duration!
    stringValue: String! @string(maxLength: 10)
    objectArray: [CustomObject!] @list(maxLength: 30)
    singleObject: CustomObject
}
"""

model_response = index_client.create_model(graphQLSchema)
```

#### Deploying a Custom Model
After creating a custom model, use the deployModel method to deploy it.

```python
index_client.deploy_model(model_response["models"][0]["id"])
```

#### Using Your Model
To use it, create a node with your model and required data.

```python
sample_node_data = {}  # Fill with your data

created_node = index_client.create_node(
  model_response["models"][0]["id"],
  sample_node_data
)

new_index = index_client.create_index("Index with your model")
added_item = index_client.add_item(new_index["id"], created_node["id"])
```

## Interact with your index
Your index is now ready for interaction! To start a conversation and interact with the data, follow these steps:

```python
conversation_params = {
  "sources": [index["id"]],
  "summary": "Mock summary"
}
conversation = index_client.create_conversation(conversation_params)

message_params = {
  "role": "user",
  "content": "How do you do this?"
}
message = index_client.create_message(conversation["id"], message_params)

messages = index_client.get_conversation(conversation["id"])
print("Retrieved Messages:", messages)
```

The response should look something like this:
```python
{
  "id": "message-id",
  "content": "How do you do this?",
  "role": "user",
  "createdAt": "timestamp"
}
```

### Listening to Conversation Updates

The Index Client SDK allows you to listen for updates to a conversation in real-time. This is useful for applications that need to react to new messages or changes in a conversation.

Here is an example of how you can use the `listen_to_index_updates` method to handle real-time updates in a conversation:

```python
conversation_id = "your-conversation-id"

def handle_message(data):
  print("New message received:", data)

def handle_error(error):
  print("Error receiving updates:", error)

index_client.listen_to_conversation_updates(
  conversation_id=conversation_id,
  handle_message=handle_message,
  handle_error=handle_error
)
```

### Listening to Index Updates

The Index Client SDK allows you to listen for updates to miltiple indexes in real-time. This is useful for applications that need to react to new data events, using natural language.

Here is an example of how you can use the `listen_to_index_updates` method to handle real-time updates in a conversation:

```python
sources = ["did:pkh:eip155:1:0x1b9Aceb609a62bae0c0a9682A9268138Faff4F5f"]
query = "if it is relevant to decentralized AI"

def handle_message(data):
  print("New event received:", data)

def handle_error(error):
  print("Error receiving updates:", error)

index_client.listen_to_index_updates(
  sources=sources,
  query=query,
  handle_message=handle_message,
  handle_error=handle_error
)
```

### Additional Methods

#### Get All Indexes
Retrieve all indexes associated with a DID.

```python
indexes = client.get_all_indexes(did="your_did")
print(indexes)
```

#### Get Profile
Retrieve the profile associated with a DID.

```python
profile = client.get_profile(did="your_did")
print(profile)
```

#### Get Index
Retrieve a specific index by its ID.
```python
index = client.get_index(index_id="your_index_id")
print(index)
```

#### Get Items
Retrieve items from an index with optional query parameters.
```python
items = client.get_items(index_id="your_index_id", query_params={"param1": "value1"})
print(items)
```

#### Create Node
Create a new node in the composed database.
```python
node_data = {
    "field1": "value1",
    "field2": "value2"
}
node = client.create_node(model_id="your_model_id", node_data=node_data)
print(node)
```

#### Update Node
Update an existing node in the composed database.
```python
updated_data = {
    "field1": "new_value1"
}
updated_node = client.update_node(model_id="your_model_id", node_id="your_node_id", node_data=updated_data)
print(updated_node)
```

#### Add Item
Add an item to an index.
```python
item_data = {
    "field1": "value1",
    "field2": "value2"
}
added_item = client.add_item(index_id="your_index_id", item=item_data)
print(added_item)
```

#### Remove Item
Remove an item from an index by its ID.
```python
removed_item = client.remove_item(index_id="your_index_id", item_id="your_item_id")
print(removed_item)
```
