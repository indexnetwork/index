import IndexClient from "@indexnetwork/sdk";

async function main() {
  try {
    // const session = "";
    const indexClient = new IndexClient({
      domain: "index.network",
      network: "ethereum",
      privateKey: process.env.PRIVATE_KEY, // or session
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
