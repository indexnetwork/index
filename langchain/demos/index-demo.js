import { OpenAIEmbeddings } from "@langchain/openai";
import { IndexVectorStore } from "../dist/index.es.js";
import IndexClient from "@indexnetwork/sdk";
import { Wallet } from "ethers";

async function main() {
  const indexClient = new IndexClient({
    domain: "https://dev.index.network",
    wallet: Wallet.createRandom(),
    network: "dev",
  });

  const embeddings = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    model: "text-embedding-ada-002",
  });

  const vectorStore = await IndexVectorStore.init(embeddings, {
    client: indexClient,
    sources: [
      "kjzl6kcym7w8y7lvuklrt4mmon5h9u3wpkm9jd9rtdbghl9df2ujsyid8d0qxj4",
    ],
  });

  const retriever = vectorStore.asRetriever();
  const result = await retriever.invoke(
    "Algorithm for Interpolating Irregularly-Spaced Data with Applications in Terrain Modelling Written by Paul Bourke Presented at Pan Pacific Computer Conference",
  );

  console.log(
    "result",
    result.map((r) => JSON.parse(r.pageContent)),
  );
}

main();
