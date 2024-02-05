import { Body, Controller, Delete, Get, Post, Put } from '@nestjs/common';
import { IndexerService } from '../service/indexer.service';
import { CrawlRequestBody, EmbeddingRequestBody, IndexDeleteBody, IndexRequestBody, IndexUpdateBody } from '../schema/indexer.schema';
import { ChromaClient } from 'chromadb';

@Controller('indexer')
export class IndexerController {

    constructor(private readonly indexerService: IndexerService) {
        // TODO: Talk about upsert
    }

    @Get('/')
    async getHello() {
        return 'Hello World';
    }

    @Post('/crawl')
    async crawl(@Body() body: CrawlRequestBody) {
        return this.indexerService.crawl(body.url);
    }

    @Post('/embeddings')
    async embeddings(@Body() body: EmbeddingRequestBody) {
        return this.indexerService.embed(body.content);
    }

    @Post('/index')
    async index(@Body() body: IndexRequestBody) {
        return this.indexerService.index(body);
    }

    @Put('/index')
    async update(@Body() body: IndexUpdateBody) {
        return this.indexerService.update(body);
    }

    @Delete('/index')
    async deleteIndex(@Body() body: IndexDeleteBody) {
        return this.indexerService.delete(body, 'index');
    }

    @Delete('/item')
    async deleteItem(@Body() body: IndexDeleteBody) {
        return this.indexerService.delete(body, 'item');
    }

}