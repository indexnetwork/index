// import IndexClient from "./index-client";
import IndexClient from "index-client";

const session = "";
const did = "";

const signerPublicKey = "";
const signerFunction = "";

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
