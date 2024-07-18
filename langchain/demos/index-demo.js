import { ChatOpenAI } from "@langchain/openai";
import {
  BasePromptTemplate,
  ChatPromptTemplate,
  PromptTemplate,
} from "@langchain/core/prompts";
import { IndexVectorStore } from "../dist/index.es.js";
import IndexClient from "@indexnetwork/sdk";
import { Document } from "@langchain/core/documents";
import {
  RunnableMap,
  RunnableLambda,
  RunnablePassthrough,
} from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ConsoleCallbackHandler } from "@langchain/core/tracers/console";
import { formatDocument } from "langchain/schema/prompt_template";
import { Wallet } from "ethers";

const DEFAULT_DOCUMENT_PROMPT = PromptTemplate.fromTemplate("{pageContent}");

// async function combineDocuments(
//   docs: Document[],
//   documentPrompt: BasePromptTemplate = DEFAULT_DOCUMENT_PROMPT,
//   documentSeparator: string = "\n\n"
// ) {
//   const docStrings: string[] = await Promise.all(
//     docs.map((doc) => {
//       return formatDocument(doc, documentPrompt);
//     })
//   );
//   return docStrings.join(documentSeparator);
// }
async function main() {
  const collectionName = "index1";
  if (!collectionName) {
    throw new Error("ZEP_COLLECTION_NAME is required");
  }

  const indexClient = new IndexClient({
    domain: "https://dev.index.network",
    wallet: Wallet.createRandom(),
    network: "dev",
  });

  const vectorStore = await IndexVectorStore.init({
    client: indexClient,
    collectionName: collectionName,
  });

  let res = await vectorStore.search({
    sources: [
      "kjzl6kcym7w8y7lvuklrt4mmon5h9u3wpkm9jd9rtdbghl9df2ujsyid8d0qxj4",
    ],
  });

  console.log("res", res);

  // const retriever = vectorStore.asRetriever();

  // const setupAndRetrieval = RunnableMap.from({
  //   context: new RunnableLambda({
  //     func: (input) => retriever.invoke(input).then(combineDocuments),
  //   }),
  //   question: new RunnablePassthrough(),
  // });
  // const outputParser = new StringOutputParser();

  // const chain = setupAndRetrieval
  //   .pipe(prompt)
  //   .pipe(model)
  //   .pipe(outputParser)
  //   .withConfig({
  //     callbacks: [new ConsoleCallbackHandler()],
  //   });

  // const result = await chain.invoke("Project Gutenberg?");

  // console.log("result", result);
}

main();
