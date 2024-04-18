import IndexClient from "@indexnetwork/sdk";
import readline from "readline";
import { v4 as uuidv4 } from "uuid";

// add your key here
const privateKey = "";

const indexId =
  "kjzl6kcym7w8y9sr5qn9o2zg771h0rgv0phmy9hg5lti7w8neoj4ujxdok7skhk";

async function main() {
  try {
    // const session = "";
    const indexClient = new IndexClient({
      domain: "index.network",
      network: "ethereum",
      privateKey, // or session
    });

    await indexClient.authenticate();

    const question = "What is $STYLE Protocol?";

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
      indexes: [indexId],
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
