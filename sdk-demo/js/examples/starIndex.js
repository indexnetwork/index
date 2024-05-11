import IndexClient from "@indexnetwork/sdk";

async function main() {
  try {
    const indexClient = new IndexClient({
      domain: "index.network",
      network: "ethereum",
      privateKey: process.env.PRIVATE_KEY, // or session
    });

    await indexClient.authenticate();

    const did = "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7";
    const indexId =
      "kjzl6kcym7w8y6b2guwuvf0jyd63w2dfl468lhzl0mtjt976espu8atqoq1znwv";

    await indexClient.starIndex(did, indexId);

    let fetchedIndex = await indexClient.getIndex(indexId);
    console.log("is starred", fetchedIndex.did.starred);

    await indexClient.unstarIndex(did, indexId);

    fetchedIndex = await indexClient.getIndex(indexId);
    console.log("is starred", fetchedIndex.did.starred);
  } catch (err) {
    console.error(err);
  }
}

main();
