// import IndexClient from "./index-client";
import IndexClient from "index-client";

const session =
  "eyJzZXNzaW9uS2V5U2VlZCI6ImZGa1YvN0lYVlhYUTFWWEV1V3J1bVlBU0pKZVV5b2RFdmFnMGlnVlZSV0U9IiwiY2FjYW8iOnsiaCI6eyJ0IjoiZWlwNDM2MSJ9LCJwIjp7ImRvbWFpbiI6ImxvY2FsaG9zdDozMDAwIiwiaWF0IjoiMjAyNC0wMy0wNVQxNToyMDo0Ni4zMDJaIiwiaXNzIjoiZGlkOnBraDplaXAxNTU6MToweDM3Q0ZjNDhDN2Y2RmY3NzFmMDVhNDQyRjE2Njc0YWIyNzU3ZDBlZDUiLCJhdWQiOiJkaWQ6a2V5Ono2TWtxTFhmaGp6em1zSGR6Z1ZpYlR4WW54cUFvQUIxREhjZWR4VnBaNWJjSEdiRiIsInZlcnNpb24iOiIxIiwibm9uY2UiOiJndzZSU1JvaG1WIiwiZXhwIjoiMjAyNC0wMy0zMFQxNToyMDo0Ni4zMDJaIiwic3RhdGVtZW50IjoiR2l2ZSB0aGlzIGFwcGxpY2F0aW9uIGFjY2VzcyB0byBzb21lIG9mIHlvdXIgZGF0YSBvbiBDZXJhbWljIiwicmVzb3VyY2VzIjpbImNlcmFtaWM6Ly8qIl19LCJzIjp7InQiOiJlaXAxOTEiLCJzIjoiMHg5N2JiNGJlOTBkNWUxZmM5NGNlNjIwOWFiZjQ3MGFmZmFiZTZkMzRkZGY4ZGI4NTM5OGJjNGFiOWEwYjRlNmEyMjBkMmU1YmMxMmY1YmE4NmQ5ZTM5N2QxOWNkMWExZTRjMDVkOTNhMjA1MTk1NzgzMTMxZGQ1YjdiMDdjYjU4ZTFjIn19fQ";
const did = "did:pkh:eip155:1:0x37CFc48C7f6Ff771f05a442F16674ab2757d0ed5";

const signerPublicKey =
  "0x0419431d7b19d5fac03dee3ddfad08b6a3d348f84ae8c222bdea529db77ec610ba3361174c88f11fb0a1ead9521079d4ff7b67f722bac3132c32aa5861587a71aa";
const signerFunction = "QmaD9FZJYst2Tntf9UwSd3QUeD68XpaPhKBSyy5wWLHq2m";

async function main() {
  try {
    const indexClient = new IndexClient();

    indexClient.authenticate({
      domain: "localhost:3000",
      session,
    });

    // const indexes = await indexClient.getAllIndexes(did);
    // console.log(indexes);
    //
    const profile = await indexClient.getProfile(did);
    console.log("Profile:", profile);

    // Create a new index
    const title = "New Index Title";
    const newIndex = await indexClient.createIndex(
      title,
      signerPublicKey,
      signerFunction,
    );
    console.log("New Index:", newIndex);

    const itemId = await indexClient.crawlLink(
      "https://www.paulgraham.com/articles.html",
    );
    console.log("Crawled Item:", itemId);

    const addedItem = await indexClient.addItemToIndex(newIndex.id, itemId);
    console.log("Added Item to Index:", addedItem);

    const fetchedIndex = await indexClient.getIndex(newIndex.id);
    console.log("Fetched Index:", fetchedIndex);
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
