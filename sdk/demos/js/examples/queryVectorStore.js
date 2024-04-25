import IndexClient from "@indexnetwork/sdk";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Wallet } from "ethers";

const indexId =
  "kjzl6kcym7w8y9sr5qn9o2zg771h0rgv0phmy9hg5lti7w8neoj4ujxdok7skhk";

async function main() {
  try {
    const wallet = new Wallet(process.env.PRIVATE_KEY);
    const indexClient = new IndexClient({
      domain: "index.network",
      network: "ethereum",
      wallet, // or session
    });

    await indexClient.authenticate();

    const vectorStore = await indexClient.getVectorStore({
      embeddings: new OpenAIEmbeddings(),
      args: {
        temperature: 0.0,
      },
    });

    const query = "What is $STYLE Protocol?";
    const filters = {
      indexId: {
        $in: [indexId],
      },
    };

    const results = await vectorStore.similaritySearch(query, 5, filters);

    console.log(results);
    /*
        [
          WebPage {
            url: 'https://styleprotocol.org/',
            title: 'Style Protocol',
            description: 'Style Protocol is a decentralized protocol for creating, trading, and managing synthetic assets.',
            image: 'https://styleprotocol.org/images/hero.png'
          },
          WebPage {
            url: 'https://styleprotocol.org/docs',
            title: 'Style Protocol Documentation',
            description: 'Style Protocol is a decentralized protocol for creating, trading, and managing synthetic assets.',
            image: 'https://styleprotocol.org/images/hero.png'
          },
          ....
        ]
      */
  } catch (err) {
    console.error(err);
  }
}

main();
