import IndexClient, { IndexVectorStore } from "@indexnetwork/sdk";
// import IndexClient, {
//   IndexVectorStore,
// } from "../../sdk/js/dist/indexclient.es.js";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Wallet } from "ethers";
import { ConversationalRetrievalQAChain } from "langchain/chains";

async function main() {
  try {
    const wallet = new Wallet(process.env.PRIVATE_KEY);
    const indexClient = new IndexClient({
      network: "dev", // or mainnet
      wallet, // or session
      domain: "indexd",
    });

    // await indexClient.authenticate();

    const embeddings = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
      model: "text-embedding-ada-002",
    });

    const sourceIndexId =
      "kjzl6kcym7w8y7lvuklrt4mmon5h9u3wpkm9jd9rtdbghl9df2ujsyid8d0qxj4";

    const vectorStore = new IndexVectorStore(embeddings, {
      client: indexClient,
      sources: [sourceIndexId],
    });

    /* Run vector store search */
    const question = "What is mesh.xyz?";
    const res = await vectorStore.similaritySearch(question, 1);
    console.log("Retieved Documents", JSON.stringify(res, null, 3));

    /* Create a QA chain */
    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: "gpt-3.5-turbo",
    });

    const chain = ConversationalRetrievalQAChain.fromLLM(
      model,
      vectorStore.asRetriever(),
    );

    /* Ask it a question */
    const qa_res = await chain.invoke({ question, chat_history: [] });
    console.log("Chat response:", JSON.stringify(qa_res, null, 3));
  } catch (err) {
    console.error(err);
  }
}

main();
