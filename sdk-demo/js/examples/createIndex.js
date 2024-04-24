import IndexClient from "@indexnetwork/sdk";

async function main() {
  try {
    // const session = "";
    const indexClient = new IndexClient({
      domain: "index.network",
      network: "ethereum",
      privateKey: process.env.PRIVATE_KEY, // or session
      // session:
      //   "eyJzZXNzaW9uS2V5U2VlZCI6IkNiVE5pK3NicEZwWUFGTFZCaXBpWkhrbVVFazlUcDhIQVg3MGpVMjU2Yjg9IiwiY2FjYW8iOnsiaCI6eyJ0IjoiZWlwNDM2MSJ9LCJwIjp7ImRvbWFpbiI6ImluZGV4Lm5ldHdvcmsiLCJpYXQiOiIyMDI0LTA0LTI0VDIwOjM5OjQ1LjMwMzc5MSIsImlzcyI6ImRpZDpwa2g6ZWlwMTU1OjE6MHgwRDczYzcyNjc2RDcyNTBlZUFlMWEzYTM1Y2ZCMmYzNjFGQzBDY0Y3IiwiYXVkIjoiZGlkOmtleTp6Nk1rcDhwaGh0dHVNeW0xQmJnNkh3eG9UQVBwb1ZMM250MW1VbkFtNnJjRWZUS3IiLCJ2ZXJzaW9uIjoiMSIsIm5vbmNlIjoibEtqdFZWeUlKNCIsImV4cCI6IjIwMjQtMDUtMjRUMjA6Mzk6NDUuMzAzNzkxIiwic3RhdGVtZW50IjoiR2l2ZSB0aGlzIGFwcGxpY2F0aW9uIGFjY2VzcyB0byBzb21lIG9mIHlvdXIgZGF0YSBvbiBDZXJhbWljIiwicmVzb3VyY2VzIjpbImNlcmFtaWM6Ly8qIl19LCJzIjp7InQiOiJlaXAxOTEiLCJzIjoiMHhiNTYyNjYxMjU5YzE2NWZhODlmMWFiZWNlNWJjYmRkMzBlNzk4ZDBhMmFlN2VhZmI4ZWE5ZGZiMjhkZmEyMTg5N2E4NzI2ZWZmZTM1NDMxMDFkNDA1YzZhZTkzYmQ3ZTRiODFkMDA5ZWUyZjMxYjJkYzdlZmQ0ZTkyOGE2ZmIzMjFiIn19fQ",
    });

    await indexClient.authenticate();

    // const indexes = await indexClient.getAllIndexes(did);
    // console.log(indexes);

    // const profile = await indexClient.getProfile(did);
    // console.log("Profile:", profile);
    //
    const newIndex = await indexClient.createIndex("Startup Articles");
    console.log("Created Index:", newIndex);

    const createdNode = await indexClient.crawlWebPage(
      "https://www.paulgraham.com/articles.html",
    );
    console.log("Crawled Web Page:", createdNode);

    const addedItem = await indexClient.addItemToIndex(
      newIndex.id,
      createdNode.id,
    );
    console.log("Added Item to Index:", addedItem);

    const fetchedIndex = await indexClient.getIndex(newIndex.id);
    console.log("Fetched Index:", fetchedIndex);
  } catch (err) {
    console.error(err);
  }
}

main();
