import IndexClient from "@indexnetwork/sdk";
import readline from "readline";
import { v4 as uuidv4 } from "uuid";

const indexId =
  "kjzl6kcym7w8y9sr5qn9o2zg771h0rgv0phmy9hg5lti7w8neoj4ujxdok7skhk";

async function main() {
  try {
    // const session = "";
    const indexClient = new IndexClient({
      domain: "index.network",
      network: "ethereum",
      privateKey: process.env.PRIVATE_KEY, // or session
    });

    await indexClient.authenticate();

    const question = "What are my indexes. list in json";

    console.clear();
    let response = "";
    for await (const messageChunk of indexClient.chat({
      id: uuidv4(), // provide a unique chat id for the query
      messages: [
        {
          content: question,
          role: "user",
        },
      ],
      // indexes: [indexId],
      did: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
    })) {
      readline.cursorTo(process.stdout, 0, 1);
      readline.clearLine(process.stdout, 0);
      response += messageChunk;
      process.stdout.write(
        `Question: ${question}\n\nQueried response: ` + response,
      );
    }
  } catch (err) {
    console.error(err);
  }
}

main();
