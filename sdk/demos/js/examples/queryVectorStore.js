import IndexClient from "@indexnetwork/sdk";
import { IndexVectorStore } from "@indexnetwork/sdk";
import { Wallet } from "ethers";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ConversationalRetrievalQAChain } from "langchain/chains";
import { exit } from "process";

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
      embeddings: new OpenAIEmbeddings({
        openai_api_key: process.env.OPENAI_API_KEY,
        openai_model: "text-embedding-ada-002",
      }),
      sources: [indexId]
    })

    /* Run vector store search */
    const question = "What is $STYLE Protocol?";
    const res = await vectorStore.similaritySearch(question, 1);
    console.log('Retieved Documents', JSON.stringify(res, null, 3)) 

    /* Create a QA chain */
    const model = new ChatOpenAI({ 
      apiKey: process.env.OPENAI_API_KEY, 
      model: "gpt-3.5-turbo"
    })

    const chain = ConversationalRetrievalQAChain.fromLLM(
      model,
      vectorStore.asRetriever()
    );

    /* Ask it a question */
    const qa_res = await chain.invoke({ question, chat_history: [] });
    console.log('Chat response:', JSON.stringify(qa_res, null, 3));

    /* Read-Only Functionality */
    // These functions are read-only and will not work in the current version of the SDK
    try {

      // Add a document to the vector store
      await vectorStore.addDocuments({ 
        id: "doc1", 
        text: "This is a test document", 
        metadata: {
          field_1: "value_1",
        }
      })
    } catch (err) {
      console.error('Add functionality is omitted with error:', err);
    }
    
    try {
      // Delete a document from the vector store
      await vectorStore.delete(["doc1"])
    } catch (err) {
      console.error('Delete functionality is omitted with error:', err);
    }

  } catch (err) {
    console.error(err);
  }
}

main();
