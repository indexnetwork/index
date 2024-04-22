import { Chroma } from '@langchain/community/vectorstores/chroma';
import { OpenAIEmbeddings } from '@langchain/openai';

type ApiResponse<T> = Promise<T>;

export default class IndexVectoreStore extends Chroma {
    private db: any;

    constructor(embeddings: OpenAIEmbeddings, args: any) {
        super(embeddings, args);
    }

    /**
     * @description Add a document to the ChromaDB [NOT SUPPORTED]
     * 
     * @param document 
     */
    override async addDocuments(): Promise<any> {
        throw new Error('Method is not supported. Use IndexClient.addIndexItem() method.');
    }

    /**
     * @description Add a document vectos to the ChromaDB [NOT SUPPORTED]
     * 
     * @param document 
     */
    override async addVectors(): Promise<any> {
        throw new Error('Method is not supported. Use IndexClient.addIndexItem() method.');
    }

    /**
     * @description Delete a document from the ChromaDB
     * 
     * @param indexIds 
     * @param query 
     * @param update 
     */
    override async delete(): Promise<any> { 
       throw new Error('Method is not supported. Use IndexClient.deleteIndexItem() method.');
    }
}