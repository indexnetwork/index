import os
from indexclient import IndexClient
from web3 import Web3
import threading
# print("os.getenv('PRIVATE_KEY')", os.getenv('PRIVATE_KEY'))

web3 = Web3()
wallet = web3.eth.account.from_key("")
client = IndexClient(domain="index.network", wallet=wallet, network="ethereum")

client.authenticate() # TODO: remove this
did = ""
try:
  index = client.create_index("for listener")

  webnode = client.crawl_web_page("http://www.paulgraham.com/publishing.html")

  created_item = client.add_item(index["id"], webnode["id"])

  conversation_params = {"sources": [did]}
  conversation = client.create_conversation(conversation_params)

  print("conversation", conversation)

  def handle_message(data):
    print("New message received:", data)

  def handle_error(error):
    print("Error receiving updates:", error)

  def listen_for_updates():
    try:
      client.listen_to_conversation_updates(
        conversation_id=conversation["id"],
        handle_message=handle_message,
        handle_error=handle_error
      )
      print("Listening to conversation updates...")
    except Exception as e:
      print(f"An exception occurred: {e}")

  # client.listen_to_conversation_updates(
  #   conversation_id=conversation["id"],
  #   handle_message=handle_message,
  #   handle_error=handle_error
  # )
  # conversation = {"id": "some_conversation_id"}

  # Creating and starting a thread to handle listening
  listener_thread = threading.Thread(target=listen_for_updates)
  listener_thread.start()

  message_params = {
    "role": "user",
    "content": "How do you do this?",
  };

  message = client.create_message(conversation["id"], message_params)
  print("message", message)

except Exception as e:
  print("Error:",e)
