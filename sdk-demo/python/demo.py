import os
from indexclient import IndexClient

client = IndexClient("index.network", private_key=os.getenv('PRIVATE_KEY'), network="ethereum")
client.authenticate()
did = "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7"
# indexes = client.get_all_indexes(did)
# print(indexes)
#
profile = client.get_profile(did)
print("Profile:", profile)
#updated_profile = client.update_profile({"name":"neo serhat", "bio": None})
#print("Updated Profile:", updated_profile)
try:
  index = client.create_index("My First Index")
  print("Index:", index)
except Exception as e:
  print(e)
