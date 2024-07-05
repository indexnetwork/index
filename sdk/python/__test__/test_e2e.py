import pytest
from eth_account import Account
import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import requests_mock
from sseclient import SSEClient
from io import StringIO
import requests
from urllib.parse import urlencode


from indexclient import IndexClient

# Test configuration
test_domain = "test.domain"
did = "did:pkh:eip155:1:0xB1dB8147c6b5dE15D762566C83a0c6be87481A7e"
test_private_key = "0x4a4815e4913effa3eab8e99a012137d29e9487700f7c0bdf08c8ce0eafe00553"
test_wallet = Account.from_key(test_private_key)

@pytest.fixture(scope="module")
def client():
  client = IndexClient(
    domain=test_domain,
    private_key=test_private_key,
    wallet=test_wallet,
    network="dev",  # or "mainnet"
  )
  client.authenticate()
  return client

def test_authenticate(client):
  assert client.session is not None

def test_get_user_profile(client):
  did = "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7"
  profile = client.get_profile(did)
  assert profile["id"] == did

def test_update_user_profile(client):
  update_params = {
    "name": "New Name",
    "bio": "New Bio",
  }
  updated_profile = client.update_profile(update_params)
  assert updated_profile["name"] == update_params["name"]
  assert updated_profile["bio"] == update_params["bio"]

def test_create_and_retrieve_index(client):
  index_title = "Test Index"
  index = client.create_index(index_title)
  assert index["title"] == index_title

  retrieved_index = client.get_index(index["id"])
  assert retrieved_index == index

def test_star_and_unstar_index(client):
  index_title = "Test Index for Starring"
  index = client.create_index(index_title)

  client.star_index(did, index["id"])
  starred_index = client.get_index(index["id"])
  assert starred_index["did"]["starred"]

  client.unstar_index(did, index["id"])
  unstarred_index = client.get_index(index["id"])
  assert not unstarred_index["did"]["starred"]

def test_own_and_disown_index(client):
  index_title = "Test Index for Owning"
  index = client.create_index(index_title)

  client.own_index(did, index["id"])
  owned_index = client.get_index(index["id"])
  print("owned_index", owned_index)
  assert owned_index["did"]["owned"]

  client.disown_index(did, index["id"])
  disowned_index = client.get_index(index["id"])
  print("disowned_index", disowned_index)
  assert not disowned_index["did"].get("owned", False) # ask why no owned field


def test_create_and_remove_item_in_index(client):
  index_title = "Test Index for Item"
  index = client.create_index(index_title)

  web_node = client.crawl_web_page("https://index.network")
  created_item = client.add_item(index["id"], web_node["id"])
  assert web_node["id"] == created_item["node"]["id"]

  client.remove_item(index["id"], web_node["id"])

  items_response = client.get_items(index["id"], {})
  assert created_item not in items_response["items"]


def test_create_update_delete_conversation(client):
  conversation_params = {"sources": [did]}
  conversation = client.create_conversation(conversation_params)
  assert conversation["sources"] == conversation_params["sources"]

  update_params = {
    "summary": "Conversation summary",
    "sources": [did],
  }
  updated_conversation = client.update_conversation(conversation["id"], update_params)
  assert updated_conversation["summary"] == update_params["summary"]

  client.delete_conversation(conversation["id"])

  latest_conv = client.get_conversation(conversation["id"])
  print("latest_conv", latest_conv)
  assert "error" in latest_conv and latest_conv["error"] == "Conversation not found"


def test_create_update_delete_message(client):
  conversation_params = {"sources": [did]}
  conversation = client.create_conversation(conversation_params)

  message_params = {
    "role": "user",
    "content": "Test message content",
  }
  message = client.create_message(conversation["id"], message_params)
  assert message["content"] == message_params["content"]

  update_params = {
    "content": "Updated test message content",
    "role": "user",
  }
  updated_message = client.update_message(conversation["id"], message["id"], update_params)
  assert updated_message["content"] == update_params["content"]

  client.delete_message(conversation["id"], message["id"])
  convo = client.get_conversation(conversation["id"])
  assert not any(m["id"] == message["id"] for m in convo["messages"])

  client.delete_conversation(conversation["id"])

def test_listen_to_conversation_updates(client):
  conversation_id = "test-conversation-id"
  event_data = 'data: {"content": "New message"}\n\n'

  # Mock the HTTP response to simulate SSE events
  with requests_mock.Mocker() as mocker:
    mocker.get(f"{client.base_url}/conversations/{conversation_id}/updates?session={client.session}",
      text=event_data,
      headers={'Content-Type': 'text/event-stream'})

    received_messages = []

    def handle_message(data):
      print("New message received:", data)
      received_messages.append(data)

    def handle_error(error):
      print("Error receiving updates:", error)

    # Run the function
    client.listen_to_conversation_updates(
      conversation_id=conversation_id,
      handle_message=handle_message,
      handle_error=handle_error
    )

    assert len(received_messages) == 1
    assert received_messages[0] == '{"content": "New message"}'

def test_listen_to_index_updates(client):
  sources = ["did:pkh:eip155:1:0x1b9Aceb609a62bae0c0a9682A9268138Faff4F5f"]
  query = "if it is relevant to decentralized AI"
  event_data = 'data: {"content": "New event"}\n\n'

  with requests_mock.Mocker() as mocker:
    params = {
      "query": query,
      "sources": ",".join(sources),
      "session": client.session
    }
    query_string = urlencode(params)
    event_url = f"{client.base_url}/discovery/updates?{query_string}"
    mocker.get(event_url, text=event_data, headers={'Content-Type': 'text/event-stream'})

    received_messages = []

    def handle_message(data):
      print("New event received:", data)
      received_messages.append(data)

    def handle_error(error):
      print("Error receiving updates:", error)

    client.listen_to_index_updates(
      sources=sources,
      query=query,
      handle_message=handle_message,
      handle_error=handle_error
    )

    assert len(received_messages) == 1
    assert received_messages[0] == '{"content": "New event"}'

if __name__ == "__main__":
  pytest.main()
