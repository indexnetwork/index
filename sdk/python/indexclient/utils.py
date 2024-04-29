import datetime
from enum import Enum
import random
import string
import json

from pydantic import ValidationError
from siwe import SiweMessage

def random_string(length: int) -> str:
  return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def to_iso_format(date: datetime.datetime) -> str:
  return date.isoformat(timespec='milliseconds') + "Z"

def json_serial(obj):
  """JSON serializer for objects not serializable by default json code"""
  if isinstance(obj, datetime):
    return obj.isoformat()  # Convert datetime object to ISO format
  if isinstance(obj, Enum):
    return obj.value  # Convert Enum to its value
  raise TypeError ("Type %s not serializable" % type(obj))

def prepare_siwe_message(message) -> str:
  """Serialize to the EIP-4361 format for signing.

  It can then be passed to an EIP-191 signing function.

  :return: EIP-4361 formatted message, ready for EIP-191 signing.
  """
  header = f"{message.domain} wants you to sign in with your Ethereum account:"

  uri_field = f"URI: {message.uri}"

  prefix = "\n".join([header, message.address])

  version_field = f"Version: {message.version}"

  chain_field = f"Chain ID: {message.chain_id or 1}"

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

def siwe_message_to_json(siwe_message):
  if not hasattr(siwe_message, '__dict__'):
    raise ValueError("The provided siwe_message doesn't seem to be an object with attributes.")

  siwe_data = {attr: getattr(siwe_message, attr) for attr in vars(siwe_message)}

  return json.dumps(siwe_data, default=json_serial)

def create_siwe_message(data):
  original_uri = data['uri']
  original_resources = data['resources']
  data['uri'] = 'https://example.com'
  data['resources'] = ['https://example.com']

  try:
    message = SiweMessage(message=data)
    message.uri = original_uri
    message.resources = original_resources
    return message
  except ValidationError as e:
    print("Validation failed:", e)
    return None

def get_signature(signed_message):
  return "0x" + signed_message.signature.hex()
