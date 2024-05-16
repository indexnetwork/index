import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OpenAIEmbeddings } from '@langchain/openai';
import { UnstructuredLoader } from 'langchain/document_loaders/fs/unstructured'
import { JSONLoader } from "langchain/document_loaders/fs/json";

import { IndexDeleteQuery, IndexUpdateBody } from '../schema/indexer.schema';
import { HttpService } from '@nestjs/axios';
import * as fs from 'fs';
import { MIME_TYPE } from '../schema/indexer.schema';
import notionCrawler from "notion-crawler";
import { TokenTextSplitter } from "langchain/text_splitter";

@Injectable()
export class IndexerService {
    constructor(
        private readonly httpService: HttpService,
        @Inject('CHROMA_DB') private readonly chromaClient: Chroma,
    ) {
    }

    /**
     * @description Crawl any document and return its content
     * 
     * @param url Url to crawl
     * @returns Web page content
     */
    async crawl(url: string): Promise<{ url: string; content: string; }>{

        if (url.includes('notion')) {

            let rootNotionPageId = url.split('-').at(-1);
            // strip numbers in the beginning of rootNotionPageId
            rootNotionPageId = rootNotionPageId.replace(/^\d+/, '');

            Logger.log(`Crawling ${rootNotionPageId}`, 'indexerService:crawlNotion');

            const { pageBlocks, notionPageIdToSlugMapper, pageMap } = await notionCrawler(
                rootNotionPageId,
            );

            Logger.log(`Crawled ${url} with ${pageBlocks.length} blocks`, 'indexerService:crawlNotion');
            Logger.log(`${JSON.stringify(pageBlocks)}`, 'indexerService:crawlnotion');
            Logger.log(`${JSON.stringify(notionPageIdToSlugMapper)}`, 'indexerService:crawlnotion');
            Logger.log(`${JSON.stringify(pageMap)}`, 'indexerService:crawlnotion');
            
            return {
                url: url,
                content: pageBlocks.join(' ')
            };
        }

        const response = await this.httpService.axiosRef({
            url: url,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            }
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
                content: docs as any
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
        // fs.unlinkSync(file_name);

        // Merge the documents
        let content = ''
        for (let doc of docs) {
            content = content.concat(doc?.pageContent);
        }

        // Clean the content
        content = content.replace(/(\r\n|\n|\r)/gm, " ");
        content = content.replace(/ +/g, " ");
        content = content.trim();

        Logger.log(`Extracted ${content.length} bytes from ${url}`, 'indexerService:crawl');

        return {
            url: url,
            content: content
        };
    }

    /**
     * @description Index a web page into ChromaDB with the given metadata
     * 
     * @param body IndexRequestBody
     * @returns Success message
     */
    async index(indexId: string, body: any  ): Promise<{ message: string }> {

        Logger.log(`Indexing ${JSON.stringify(body)?.length} bytes`, 'indexerService:index');
        
        const chromaID = await this.generateChromaID(indexId, body); 

        try {

            let payload = {}
            
            const payload_keys = Object.keys(body);
            
            let model_type = '';
            payload_keys.forEach((key) => {
                if (key.includes('_')){
                    // Get the model type
                    model_type = key.split('_')[0];
                    // Model based keys
                    let chroma_key = key.split('_')[1];
                    payload[chroma_key] = body[key];

                } else {
                    // Index based keys
                    if ( key !== 'vector' ) { payload[key] = body[key]; }
                }
            });

            payload['model'] = model_type;
            let pageContent = JSON.stringify(payload)
            
            // Reduce the content size for indexing
            const splitter = new TokenTextSplitter();
            Logger.log(`Splitting ${pageContent.length} bytes`, 'indexerService:index');    
            let tokens =  await splitter.splitText(pageContent);
            if ( tokens.length > 8000 ) { 
                tokens = tokens.slice(0, 8000) ;
                Logger.log('Reducing token length', "indexerService:index:tokensLength");
                pageContent = tokens.join(" ");
            }

            pageContent = pageContent.replace(/(\r\n|\n|\r)/gm, " ");
            pageContent = pageContent.replace(/ +/g, " ");
            pageContent = pageContent.trim();

            Logger.log(`Reduced ${pageContent}`, 'indexerService:index');

            const documents = [{
                pageContent,
                metadata: payload
            }]

            const ids = await this.chromaClient.addDocuments(documents, {ids: [chromaID] });

            Logger.log(`Indexed ${JSON.stringify(ids)}`, 'indexerService:index');

            return {
                message: `Successfully indexed ${body.indexTitle} with id ${ids[0]}`
            }

        } catch (e) {
            console.log(e); throw e;
        }
    }
    
    /**
     * @description Updates the document at ChromaDB with the given indexId and indexItemId
     * 
     * @param body 
     * @returns Success or error message
     */
    async update(indexId: string , indexItemId: string, body: IndexUpdateBody): Promise<{ message: string }> {

        const chromaID = await this.generateChromaID(indexId, indexItemId);

        try {

            let updated = {
                ids: chromaID
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
    async delete(indexId: string, indexItemId: string | null): Promise<{ message: string }> {

        let response;

        const chromaID = await this.generateChromaID(indexId, indexItemId);

        try {

            if (indexItemId) { 

                const res = await this.chromaClient.collection.get({
                    ids: [chromaID],
                    limit: 1,
                })

                if (res.ids.length === 0) Logger.warn('Delete failed, document not found', 'indexerService:delete');

                const response = await this.chromaClient.collection.delete({ ids: [chromaID] }) 
            
                Logger.debug(`Delete Response ${JSON.stringify(response)}`, 'indexerService:delete');
                
                // if (!response) throw new Error('Delete failed');

                return {
                    message: `Successfully deleted ${JSON.stringify(response)}`
                }

            } else {

                const res = await this.chromaClient.collection.get({
                    where: { "indexId": indexId },
                    limit: 1000,
                })
                  
                Logger.log(`Deleting ${JSON.stringify(res?.ids)}`, 'indexerService:delete');

                response = await this.chromaClient.collection.delete({ ids: res?.ids })

                if (!response) Logger.warn(`Delete failed for ${res?.ids}`, 'indexerService:delete');

                return {
                    message: `Successfully deleted ${response.ids.length} documents`
                }

            }

        } catch (e) {
            return {
                message: `Delete error for ${indexId}`
            }
        }
    }

    /** 
     * @description Embed a web page into ChromaDB
     * 
     * @param content
     * @returns Embedding vector
    */
    async embed(content: string | null): Promise<{ model: string; vector: number[]; } | HttpStatus.OK>  {

        // If no content, return OK 
        // This is a temporary fix for the API for now
        if (!content) return HttpStatus.OK;

        try {

            const embeddings = new OpenAIEmbeddings({
                modelName: process.env.MODEL_EMBEDDING,
                openAIApiKey:process.env.OPENAI_API_KEY
            });

            Logger.log(`Creates embedding ${content.length} bytes of content`, 'indexerService:embed');

            const embedding = await embeddings.embedDocuments([content]);

            Logger.log(`Embedded successfully, with embed length ${embedding.length}`, 'indexerService:embed');

            return {
                model: process.env.MODEL_EMBEDDING,
                vector: embedding[0]
            };
        }
        catch (e) {
            console.log(e.message);
        }

    }

    private async generateChromaID(indexId: string, body: any): Promise<string> {
        
        // fix id generation
        const randseq = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

        return indexId + '-' + randseq;
    }

}
