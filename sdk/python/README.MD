<h1 align="center">
    <a href="https://index.network/#gh-light-mode-only">
    <img style="width:400px" src="https://index.network/images/IndexNetworkLogo.png">
    </a>
</h1>
<p align="center">
  <i align="center">Discovery Protocol 🚀</i>
</p>


# Index Network Python SDK

Index is a discovery protocol that functions as a decentralized search engine which offers an open layer for discovery. As the first decentralized semantic index which leverages Web3 and AI to eliminate the need for intermediaries for finding knowledge, products and like-minded people through direct, composable discovery across peers.
Here's a quick start guide.

## Using the Index Network Python SDK

The Index Network offers a Python SDK to facilitate various operations on our platform. This guide will walk you through setting up the SDK, authenticating, creating an Index, and adding an Item to it and finally interacting with it.


### Installation

First, install the indexnetwork-sdk package via pip:

```
pip install indexnetwork-sdk
```


Creating an Instance of IndexClient

```
from indexnetwork-sdk import IndexClient

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

response = client.chat(chat_id, messages, index_id)

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
