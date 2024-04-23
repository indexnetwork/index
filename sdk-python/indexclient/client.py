import json
from dataclasses import asdict
import requests
from .config import IndexConfig
from .types import User, Link
from .utils import random_string
from web3 import Web3
from web3.auto import w3
from datetime import datetime, timedelta
from Crypto.Random import get_random_bytes
from eth_account.messages import encode_defunct
# from siwe import SiweMessage
from urllib.parse import urlencode

class IndexClient:
    def __init__(self, domain, session=None, private_key=None, network="ethereum"):
      self.base_url = IndexConfig.API_URL
      self.session = session
      self.private_key = private_key
      self.domain = domain
      self.network = network

    def request(self, endpoint, method="GET", data=None):
      url = f"{self.base_url}{endpoint}"
      headers = {
          "Authorization": f"Bearer {self.session}",
          "Content-Type": "application/json"
      }
      if method == "GET":
          response = requests.get(url, headers=headers)
      else:
          response = requests.request(method, url, json=data, headers=headers)

      response.raise_for_status()
      return response.json()

    def authenticate(self, session=None):
      if session:
          self.session = session
          return
      # if not self.private_key or not self.domain:
      #   raise Exception("Private key and domain are required to authenticate")

      # # Set up the wallet with the private key
      # web3 = Web3(Web3.HTTPProvider(IndexConfig.LIT_PROTOCOL_RPC_PROVIDER_URL))
      # account = web3.eth.account.from_key(self.private_key)
      # address = account.address

      # # Random seed generation and DID key creation (simulated here as this is complex)
      # key_seed = get_random_bytes(32)
      # did_key_id = f"did:key:{key_seed.hex()}"  # Simplified example of DID ID

      # now = datetime.utcnow()
      # one_month_later = now + timedelta(days=30)

      # # Create a SIWE (Sign-In with Ethereum) message
      # nonce = random_string(10)
      # siwe_message: SiweMessage = SiweMessage(message={
      #   "domain": self.domain,
      #   "address": address,
      #   "statement": "Give this application access to some of your data on Ceramic",
      #   "uri": did_key_id,
      #   "version": 1,
      #   "chainId": 1,
      #   "nonce": nonce,
      #   "issuedAt": now.isoformat(),
      #   "expirationTime": one_month_later.isoformat(),
      #   "resources": ["ceramic://*"]
      # })

      # # message_encoded = encode_defunct(text=message)

      # # Sign the message with the private key
      # signature = account.sign_message(siwe_message.to_message())

      # siwe_message.signature = signature.signature.hex()
    def _request(self, endpoint, method="GET", data=None):
      url = f"{self.base_url}{endpoint}"
      headers = {
        "Authorization": f"Bearer {self.session}",
        "Content-Type": "application/json"
      }
      response = requests.request(method, url, headers=headers, json=data)
      # response.raise_for_status()
      return response.json()

    def get_all_indexes(self, did):
      return self._request(f"/dids/{did}/indexes", "GET")

    def get_profile(self, did):
      return self._request(f"/dids/{did}/profile", "GET")

    def get_index(self, index_id):
      return self._request(f"/indexes/{index_id}", "GET")

    def update_profile(self, params):
      print("sent: ", json.dumps(params))
      return self._request("/profile", "PATCH", json.dumps(params))

    def update_index(self, id, index):
      return self._request(f"/indexes/{id}", "PATCH", index)

    def crawl_web_page(self, url):
      return self._request("/web2/webpage/crawl", "POST", {"url": url})

    def get_lit_actions(self, cid):
      return self._request(f"/lit_actions/{cid}", "GET")

    def post_lit_action(self, action):
      return self._request("/lit_actions", "POST", action)

    def get_items(self, index_id, query_params):
      if query_params:
        query_string = urlencode(query_params)
      else:
        query_string = ""
      return self._request(f"/indexes/{index_id}/items?{query_string}", "GET")

    def create_index(self, title):
      body = {
        "title": title,
        "signerFunction": IndexConfig.DEFAULT_CID
      }
      print(body)
      return self._request("/indexes", "POST", body)

    def add_item_to_index(self, index_id, item_id):
      return self._request(f"/indexes/{index_id}/items/{item_id}", "POST")

    def delete_item_from_index(self, index_id, item_id):
      return self._request(f"/indexes/{index_id}/items/{item_id}", "DELETE")

    def get_ens_name_details(self, ens_name):
      return self._request(f"/ens/{ens_name}", "GET")

    def create_item(self, index_id, item):
      return self._request(f"/indexes/{index_id}/items", "POST", item)

    def delete_item(self, index_id, item_id):
      return self._request(f"/indexes/{index_id}/items/{item_id}", "DELETE")

    def star_index(self, did, index_id):
      return self._request(f"/dids/{did}/indexes/{index_id}/star", "PUT")

    def unstar_index(self, did, index_id):
      return self._request(f"/dids/{did}/indexes/{index_id}/star", "DELETE")

    def own_index(self, did, index_id):
      return self._request(f"/dids/{did}/indexes/{index_id}/own", "PUT")

    def disown_index(self, did, index_id):
      return self._request(f"/dids/{did}/indexes/{index_id}/own", "DELETE")

    def get_nft_metadata(self, network, address, token_id=None):
      endpoint = f"/nft/{network}/{address}"
      if token_id:
        endpoint += f"/{token_id}"
      return self._request(endpoint, "GET")

    def resolve_ens(self, ens_name):
      return self._request(f"/ens/{ens_name}", "GET")

    def get_node_by_id(self, model_id, node_id):
      return self._request(f"/composedb/{model_id}/{node_id}", "GET")

    def create_node(self, model_id, node_data):
      return self._request(f"/composedb/{model_id}", "POST", node_data)

    def update_node(self, model_id, node_id, node_data):
      return self._request(f"/composedb/{model_id}/{node_id}", "PATCH", node_data)
