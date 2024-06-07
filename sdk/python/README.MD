<h1 align="center">
    <a href="https://index.network/#gh-light-mode-only">
    <img style="width:400px" src="https://index.network/images/IndexNetworkLogo.png">
    </a>
</h1>
<p align="center">
  <i align="center">Discovery Protocol 🚀</i>
</p>


# Index Network Python SDK

Index is a discovery protocol that eliminates the need for intermediaries when finding knowledge, products, and like-minded people through direct, composable discovery across the web. By leveraging Web3 and AI, Index offers an open layer for discovery as the first decentralized semantic index. It functions as a composable vector database with a user-centric perspective, enabling interaction with decentralized graphs.


## Using the Index Network Python SDK

The Index Network offers a Python SDK to facilitate various operations on our platform. This guide will walk you through setting up the SDK, authenticating, creating an Index, and adding an Item to it and finally interacting with it.

### Installation

First, install the indexnetwork-sdk package via pip:


```
pip install indexnetwork-sdk
```


Creating an Instance of IndexClient

```
from indexclient import IndexClient

client = IndexClient(
    domain="index.network",
    wallet=your_wallet_object,  # Provide your wallet instance
    network="ethereum"  # Specify the network you're working on
)
```

Authenticate it.

```
client.authenticate()
```

### Creating an Index

We're ready. Now, let's create an Index with a title.

```
index_id = client.create_index("Future of publishing")
```

Voilà, now you have a truly decentralized index to interact with! Though it's empty, which means we need to create and add an Item into it so we can interact. Let's do that.

```
web_page_id = client.crawl_web_page("http://www.paulgraham.com/publishing.html")
client.add_item_to_index(index_id, web_page_id)
````



### Interacting with an Index

Your index is now ready for interaction! Querying the index is straightforward:

```
import uuid

chat_id = str(uuid.uuid4())

messages = [
    {
        "content": "How do you evaluate a startup?",
        "role": "user",
    },
]

response = client.chat(chat_id, messages, sources=[index_id])

print(response)
```

The response should look something like this:
```
{
  "response": "This article discusses the intricacies and challenges of publishing ... strategies for successful online publishing."
  "sources": [
    {
      "itemId": "kjzl6kcy...ii7z1anybovo",
      "indexId": "rt38xm13...b2ca76w5ky27",
    }
  ]
}
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
