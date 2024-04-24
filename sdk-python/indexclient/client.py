import base64
import secrets
import json
import os
from dataclasses import asdict

from pydantic import ValidationError
import requests
from .config import IndexConfig
from .types import User, Link
from .utils import random_string
from web3 import Web3
from web3.auto import w3
from datetime import datetime, timedelta
from Crypto.Random import get_random_bytes
from eth_account.messages import encode_defunct
from siwe import SiweMessage
from urllib.parse import urlencode
import subprocess
from enum import Enum

class VersionEnum(str, Enum):
    """EIP-4361 versions."""

    one = "1"

    def __str__(self):
        """EIP-4361 representation of the enum field."""
        return self.value

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

    def run_js(self, method, params):
      # Prepare the command to run the binary with parameters
      base_path = os.path.dirname(os.path.abspath(__file__))
      session_path = os.path.join(base_path, 'session')
      command = [session_path, method] + params
      # Run the command and capture the output
      result = subprocess.run(command, text=True, capture_output=True)
      return result.stdout.strip()

    def create_siwe_message(self, data):
      # Temporarily replace the problematic URI with a valid one for validation purposes
      original_uri = data['uri']
      original_resources = data['resources']
      data['uri'] = 'https://example.com'
      data['resources'] = ['https://example.com']

      try:
          message = SiweMessage(message=data)
          # Restore the original URI after successful object creation
          message.uri = original_uri
          message.resources = original_resources
          return message
      except ValidationError as e:
          print("Validation failed:", e)
          return None

    def json_serial(self, obj):
        """JSON serializer for objects not serializable by default json code"""
        if isinstance(obj, datetime):
            return obj.isoformat()  # Convert datetime object to ISO format
        if isinstance(obj, Enum):
            return obj.value  # Convert Enum to its value
        raise TypeError ("Type %s not serializable" % type(obj))

    # Function to convert siwe_message to JSON string
    def siwe_message_to_json(self, siwe_message):
        # Assuming siwe_message is a dictionary-like object or has attributes you can list
        if not hasattr(siwe_message, '__dict__'):
            raise ValueError("The provided siwe_message doesn't seem to be an object with attributes.")

        # Convert the siwe_message object's attributes to a dictionary
        siwe_data = {attr: getattr(siwe_message, attr) for attr in vars(siwe_message)}

        # Convert the dictionary to a JSON string, handling non-serializable objects
        return json.dumps(siwe_data, default=self.json_serial)

    def prepare_message(self, message) -> str:
        """Serialize to the EIP-4361 format for signing.

        It can then be passed to an EIP-191 signing function.

        :return: EIP-4361 formatted message, ready for EIP-191 signing.
        """
        header = f"{message.domain} wants you to sign in with your Ethereum account:"

        uri_field = f"URI: {message.uri}"

        prefix = "\n".join([header, message.address])

        version_field = f"Version: {message.version}"

        chain_field = f"Chain ID: {message.chain_id or 1}"
        print("chain_field in prep", chain_field)

        nonce_field = f"Nonce: {message.nonce}"

        suffix_array = [uri_field, version_field, chain_field, nonce_field]

        issued_at_field = f"Issued At: {message.issued_at}"
        suffix_array.append(issued_at_field)

        if message.expiration_time:
            expiration_time_field = f"Expiration Time: {message.expiration_time}"
            suffix_array.append(expiration_time_field)

        if message.not_before:
            not_before_field = f"Not Before: {message.not_before}"
            suffix_array.append(not_before_field)

        if message.request_id:
            request_id_field = f"Request ID: {message.request_id}"
            suffix_array.append(request_id_field)

        if message.resources:
            resources_field = "\n".join(
                ["Resources:"] + [f"- {resource}" for resource in message.resources]
            )
            suffix_array.append(resources_field)

        suffix = "\n".join(suffix_array)

        if message.statement:
            prefix = "\n\n".join([prefix, message.statement])
        else:
            prefix += "\n"

        return "\n\n".join([prefix, suffix])

    def authenticate(self, session=None):
      if session:
          self.session = session
          return
      key_seed = get_random_bytes(32)
      key_seed_str = base64.b64encode(key_seed).decode('utf-8')
      # key_seed_str = "jCYbroMufNEUqlm/cHjhtXGOWLi3wzQECgqBnZ9kT7I="
      did_key_id = self.run_js("key", [key_seed_str])

      print("did_key_id:",did_key_id)
      # return

      # if not self.private_key or not self.domain:
      #   raise Exception("Private key and domain are required to authenticate")

      # Set up the wallet with the private key
      web3 = Web3(Web3.HTTPProvider(IndexConfig.LIT_PROTOCOL_RPC_PROVIDER_URL))
      account = web3.eth.account.from_key(self.private_key)
      address = account.address

      # Random seed generation and DID key creation (simulated here as this is complex)

      # did_key_id = f"did:key:{key_seed.hex()}"  # Simplified example of DID ID
      # use binary for did_key

      now = datetime.utcnow()
      one_month_later = now + timedelta(days=30)

      # did_key_id = "did:key:z6Mkq9mCbyXBgYdNuwZFGNUw4ih35PbJzHX82tbUCqtgudXM"

      # Create a SIWE (Sign-In with Ethereum) message
      nonce = random_string(10)
      siwe_data = {
        "domain": self.domain,
        "address": address,
        "statement": "Give this application access to some of your data on Ceramic",
        "uri": did_key_id,
        "version": VersionEnum.one,
        "chain_id": 1,
        # "nonce": nonce,
        "nonce": "vEFr20hq5k",
        "issued_at": "2024-04-24T15:45:48.460Z",
        # "issued_at": now.isoformat(),
        # "expiration_time": one_month_later.isoformat(),
        "expiration_time": "2024-05-24T15:45:48.460Z",
        "resources": ['ceramic://*']
      }

      siwe_message = self.create_siwe_message(siwe_data)
      siwe_message_str = self.siwe_message_to_json(siwe_message)
      signed_message = account.sign_message(
        encode_defunct(text=self.prepare_message(siwe_message))
      )
      signature = signed_message.signature.hex()
      print("session params:", siwe_message_str, signature, key_seed_str)

      print("siwe_message:", siwe_message)
      session = self.run_js("session", [siwe_message_str, signature, key_seed_str])

      print("siwe_message_str", siwe_message_str)
      print("session:", session)
      self.session = session
      # use binary for did_session

      # message_encoded = encode_defunct(text=message)


      # Sign the message with the private key


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
