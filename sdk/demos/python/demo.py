import os
from indexclient import IndexClient
from web3 import Web3
# print("os.getenv('PRIVATE_KEY')", os.getenv('PRIVATE_KEY'))

web3 = Web3()
wallet = web3.eth.account.from_key("")
client = IndexClient(domain="index.network", wallet=wallet, network="ethereum")
# client = IndexClient("index.network", private_key=os.getenv('PRIVATE_KEY'), network="ethereum")

client.authenticate() # TODO: remove this
did = "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7"
# indexes = client.get_all_indexes(did)
# print(indexes)
#
# profile = client.get_profile(did)
# print("Profile:", profile)
#   index = client.create_index("My First Index")
#   print("Index:", index)
try:
  # updated_profile = client.update_profile({"name":"neo serhat"})
  # print("Updated Profile:", updated_profile)
  index = client.create_index("My First Index")
  print("Index:", index)
except Exception as e:
  print("Error:",e)
