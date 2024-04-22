import IndexClient from "@indexnetwork/sdk";
import IndexVectoreStore from "@indexnetwork/lib/chroma";
import readline from "readline";
import { v4 as uuidv4 } from "uuid";

// add your key here
const privateKey = "";

const indexId =
  "kjzl6kcym7w8y9sr5qn9o2zg771h0rgv0phmy9hg5lti7w8neoj4ujxdok7skhk";

async function main() {

    try {
      
      const embeddings = new OpenAIEmbeddings();  
      const args = {
        temperature: 0.0,
      };
      const vectorStore = IndexVectoreStore({
        embeddings,
        args,
      });
      
      const query = "What is $STYLE Protocol?"; 
      const filters = {
        indexId: {
            $in: chroma_indices
        }
      }

      const results = await vectorStore.similaritySearch( query, 5, filters ); 

      console.log( results );
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