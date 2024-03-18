import IndexClient from "@indexnetwork/sdk";

const session = "";
const did = "did:pkh:eip155:1:0x37CFc48C7f6Ff771f05a442F16674ab2757d0ed5";

const privateKey = "";

async function main() {
  try {
    const indexClient = new IndexClient({
      domain: "index.network",
      network: "ethereum",
      privateKey,
    });

    indexClient.authenticate();

    // const indexes = await indexClient.getAllIndexes(did);
    // console.log(indexes);

    // const profile = await indexClient.getProfile(did);
    // console.log("Profile:", profile);

    // Create a new index
    try {
      const title = "New Index Title";
      const newIndex = await indexClient.createIndex(title);
      console.log("New Index:", newIndex);

      // const itemId = await indexClient.crawlLink(
      //   "https://www.paulgraham.com/articles.html",
      // );
      // console.log("Crawled Item:", itemId);

      // const addedItem = await indexClient.addItemToIndex(newIndex.id, itemId);
      // console.log("Added Item to Index:", addedItem);

      // const fetchedIndex = await indexClient.getIndex(newIndex.id);
      // console.log("Fetched Index:", fetchedIndex);
    } catch (err) {
      console.error("Error creating index:", err);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
