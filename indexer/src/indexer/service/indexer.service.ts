import { Inject, Injectable, Logger } from '@nestjs/common';
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OpenAIEmbeddings } from '@langchain/openai';
import { UnstructuredLoader } from 'langchain/document_loaders/fs/unstructured'
import { JSONLoader } from "langchain/document_loaders/fs/json";

import { IndexDeleteBody, IndexRequestBody, IndexUpdateBody } from '../schema/indexer.schema';
import { HttpService } from '@nestjs/axios';
import * as fs from 'fs';
import { MIME_TYPE } from '../schema/indexer.schema';


@Injectable()
export class IndexerService {
    constructor(
        private readonly httpService: HttpService,
        @Inject('CHROMA_DB') private readonly chromaClient: Chroma,
    ) {
        
        // TODO: Add support for chunked documents
        // TODO: Add support for multiple documents opts
    }

    /**
     * @description Crawl any document and return its content
     * 
     * @param url Url to crawl
     * @returns Web page content
     */
    async crawl(url: string): Promise<{ url: string; content: string | Document[]; }>{

        const response = await this.httpService.axiosRef({
            url: url,
            method: 'GET',
            responseType: 'stream',
        });

        const content_type = response.headers['content-type'].split(';')[0];

        if (!MIME_TYPE.hasOwnProperty(content_type)) throw new Error('Unsupported content type');

        // Write the file to disk
        const file_name = `tmp/${Date.now()}.${MIME_TYPE[content_type]}`;
        const writer = fs.createWriteStream(file_name);
        response.data.pipe(writer);
        
        // Wait for the file to be written
        const status = new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        await status;

        // Check if the file was written
        if (!status) throw new Error('Failed to download page');
        Logger.log(`Downloaded ${url} to ${file_name}`, 'indexerService:crawl');

        
        // Add an exception for JSON files
        if (MIME_TYPE[content_type] === 'json') {
            const loader = new JSONLoader(file_name);
            const docs = await loader.load();
            return {
                url: url,
                content: '' //docs
            }
        }

        // Initialize the loader
        const loader = new UnstructuredLoader(
            file_name,
            {
                apiUrl: process.env.UNSTRUCTURED_API_URL,
            }
        );

        // Load the document
        const docs = await loader.load();
        
        // Delete the file
        fs.unlinkSync(file_name);

        return {
            url: url,
            content: docs[0].pageContent
        };
    }

    /**
     * @description Index a web page into ChromaDB with the given metadata
     * 
     * @param body IndexRequestBody
     * @returns Success message
     */
    async index(body: IndexRequestBody): Promise<{ message: string }> {

        const chromaID = body.indexId + body.webPageId;
        
        try {

            let metadata = {
                source: body.webPageId
            }

            const metadata_keys = [
                "indexId", "indexTitle", "indexCreatedAt", "indexUpdatedAt",
                "indexOwnerDID", "indexOwnerName", "indexOwnerBio",
                "webPageId", "webPageTitle", "webPageUrl",
                "webPageCreatedAt", "webPageUpdatedAt"
            ];

            metadata_keys.forEach((key) => {
                metadata[key] = body[key];
            });

            const documents = [{
                pageContent: body.webPageContent,
                metadata
            }]

            const ids = await this.chromaClient.addDocuments(documents, {ids: [chromaID]});

            return {
                message: `Successfully indexed ${body.webPageTitle} with id ${ids[0]}`
            }

        } catch (e) {
            console.log(e); throw e;
        }
    }

    /**
     * @description Deletes the document from ChromaDB with the given indexId and indexItemId
     * 
     * @param body 
     * @returns Success or error message
     */
    async update(body: IndexUpdateBody): Promise<{ message: string }> {

        const chromaID = body.indexId + body.indexItemId;

        try {

            let updated = {
                ids: chromaID,
            }
    
            if (body.embedding) { updated['embedding'] = body.embedding; }
            if (body.metadata) { updated['metadata'] = body.metadata; }
    
            const response = await this.chromaClient.collection.update(updated)
            
            return {
                message: `Successfully updated ${chromaID}`
            }

        } catch (e) {
            return {
                message: `Update error for ${chromaID}`
            }
        }

    }


    /**
     * @description Deletes the document from ChromaDB with the given indexId and indexItemId
     * 
     * @param body 
     * @returns Success or error message
     */
    async delete(body: IndexDeleteBody, deleteType: string): Promise<{ message: string }> {

        try {

            let response;

            const chromaID = body.indexId + body.indexItemId;  
            

            if (deleteType === 'item') { 

                if (!body.indexItemId) throw new Error('indexItemId is required');

                const res = await this.chromaClient.collection.get({
                    ids: [chromaID],
                    limit: 1,
                })
                if (res.ids.length === 0) throw new Error('Delete failed, document not found');


                const response = await this.chromaClient.collection.delete({ ids: [chromaID] }) 
            

                if (!response) throw new Error('Delete failed');

                return {
                    message: `Successfully deleted ${JSON.stringify(response)}`
                }

            } else if (deleteType === 'index') {

                const res = await this.chromaClient.collection.get({
                    where: { "indexId": body.indexId },
                    limit: 1000,
                })
                  
                Logger.log(`Deleting ${JSON.stringify(res?.ids)}`, 'indexerService:delete');

                response = await this.chromaClient.collection.delete({ ids: res?.ids })

                if (!response) throw new Error('Delete failed');

                return {
                    message: `Successfully deleted ${response.ids.length} documents`
                }
            }

        } catch (e) {
            return {
                message: `Delete error for ${body.indexId}`
            }
        }

    }

    /** 
     * @description Embed a web page into ChromaDB
     * 
     * @param content
     * @returns Embedding vector
    */
    async embed(content: string): Promise<{ model: string; vector: number[]; }>  {

        try {

            const embeddings = new OpenAIEmbeddings({
                modelName: process.env.MODEL_EMBEDDING,
                openAIApiKey:process.env.OPENAI_API_KEY
            });

            Logger.log(`Embedding ${JSON.stringify(content)}`, 'indexerService:embed');

            const embedding = await embeddings.embedDocuments([content]);

            return {
                model: process.env.MODEL_EMBEDDING,
    
                vector: embedding[0]
            };
        }
        catch (e) {
            console.log(e);
        }

    }

}
