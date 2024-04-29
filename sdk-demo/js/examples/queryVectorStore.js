// import IndexClient from "@indexnetwork/sdk";
import { ChromaClient } from 'chromadb'
import { OpenAIEmbeddingFunction } from 'chromadb'



const indexId =
  "kjzl6kcym7w8y9sr5qn9o2zg771h0rgv0phmy9hg5lti7w8neoj4ujxdok7skhk";

async function main() {
  try {

    const client = new ChromaClient({
        path: "http://localhost:8000/chroma",
        // auth: "chromadb.auth.basic_authn.BasicAuthClientProvider"
    })

    const embeddingFunction = new OpenAIEmbeddingFunction({
        openai_api_key: process.env.OPENAI_API_KEY,
        openai_model: "text-embedding-ada-002",
      })

    const embeddings = await embeddingFunction.generate(["What is $STYLE Protocol?"]);

    const collection = await client.getCollection({
        name: "chroma-indexer", 
        embeddingFunction: embeddingFunction,
    })
  
    try {

      const peek = await collection.peek({limit: 10})
      
      console.log('Peek', peek)

      let docs = await collection.query({
        queryEmbeddings: embeddings,
        nResults: 10,
        include: ["embeddings", "metadatas", "documents"],
      });

      console.log('Docs', docs)

    } catch (err) {

      console.log('ERROR', err);

    }

    // curl --header "Content-Type: application/json" \
    //      --request POST \
    //      --data '{ "limit": 10 }' \
    //      http://chroma-chromadb.env-dev:8000/api/v1/collections/fc19e960-9077-4978-8c23-a2cd9f026458/get

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
