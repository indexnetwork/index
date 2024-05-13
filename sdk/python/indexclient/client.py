import base64
import secrets
import json
import os
from dataclasses import asdict
import requests
from siwe.siwe import VersionEnum
from .config import IndexConfig
from .index_types import User, Link
from .utils import create_siwe_message, get_signature, prepare_siwe_message, random_string, siwe_message_to_json, to_iso_format
from web3 import Web3
from datetime import datetime, timedelta
from Crypto.Random import get_random_bytes
from eth_account.messages import encode_defunct
from siwe import SiweMessage
from urllib.parse import urlencode
import subprocess
from enum import Enum

class IndexClient:
    def __init__(self, domain, session=None, private_key=None, wallet=None, network="ethereum"):
      self.session = session
      self.private_key = private_key
      self.domain = domain
      self.wallet = wallet
      self.network = network
      if self.network == "mainnet":
        self.base_url = "https://index.network/api"
      else:
        self.base_url = "https://dev.index.network/api"

    def call_did(self, method, params):
      base_path = os.path.dirname(os.path.abspath(__file__))
      session_path = os.path.join(base_path, 'bin', 'session.bin')
      command = [session_path, method] + params
      result = subprocess.run(command, text=True, capture_output=True)
      return result.stdout.strip()

    def authenticate(self, session=None):
      if session:
          self.session = session
          return

      if not self.wallet or not self.domain:
        raise Exception("Private key and domain are required to authenticate")

      key_seed = get_random_bytes(32)
      key_seed_str = base64.b64encode(key_seed).decode('utf-8')
      did_key_id = self.call_did("key", [key_seed_str])

      now = datetime.utcnow()
      one_month_later = now + timedelta(days=30)

      nonce = random_string(10)
      siwe_data = {
        "domain": self.domain,
        "address": self.wallet.address,
        "statement": "Give this application access to some of your data on Ceramic",
        "uri": did_key_id,
        "version": VersionEnum.one,
        "chain_id": 1,
        "issued_at": to_iso_format(now),
        "expiration_time": to_iso_format(one_month_later),
        "nonce": nonce,
        "resources": ['ceramic://*']
      }

      siwe_message = create_siwe_message(siwe_data)
      signed_message = self.wallet.sign_message(
        encode_defunct(text=prepare_siwe_message(siwe_message))
      )
      signature = get_signature(signed_message)
      siwe_message_str = siwe_message_to_json(siwe_message)

      session = self.call_did("session", [siwe_message_str, signature, key_seed_str])
      self.session = session

    def _request(self, endpoint, method="GET", data=None):
      url = f"{self.base_url}{endpoint}"
      headers = {
        "Authorization": f"Bearer {self.session}",
        "Content-Type": "application/json"
      }
      response = requests.request(method, url, headers=headers, json=data)
      return response.json()

    def get_all_indexes(self, did):
      return self._request(f"/dids/{did}/indexes", "GET")


    def get_profile(self, did):
      return self._request(f"/dids/{did}/profile", "GET")

    def get_index(self, index_id):
      return self._request(f"/indexes/{index_id}", "GET")

    def update_profile(self, params):
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

    def create_index(self, title, signer_function=None):
      body = {
        "title": title,
      }

      if signer_function:
        body["signer_function"] = signer_function

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
