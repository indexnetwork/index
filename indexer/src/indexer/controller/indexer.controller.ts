import { Body, Controller, Delete, Get, Patch, Post, Put, Query } from '@nestjs/common';
import { IndexerService } from '../service/indexer.service';
import { CrawlRequestBody, EmbeddingRequestBody, IndexDeleteQuery, IndexItemDeleteQuery, IndexRequestBody, IndexUpdateBody, IndexUpdateQuery } from '../schema/indexer.schema';
import { ChromaClient } from 'chromadb';
import { ApiQuery } from '@nestjs/swagger';

@Controller('indexer')
export class IndexerController {

    constructor(private readonly indexerService: IndexerService) {
    }

    @Post('/crawl')
    async crawl(@Body() body: CrawlRequestBody) {
        return this.indexerService.crawl(body.url);
    }

    @Post('/embedding')
    async embeddings(@Body() body: EmbeddingRequestBody) {
        return this.indexerService.embed(body.content);
    }

    // INDEX-WISE OPERATIONS

    @Post('/index')
    @ApiQuery({ name: 'indexId', required: true })
    async createIndex(@Query('indexId') indexId: string, @Body() body: IndexRequestBody) {
        return this.indexerService.index(indexId, body);
    }

    @Patch('/index')
    @ApiQuery({ name: 'indexId', required: true })
    async updateIndex(@Query('indexId') indexId: string, @Body() body: IndexUpdateQuery) {
        // TODO: Add update whole index -> update all index items
        // return this.indexerService.update(indexId, null);
    }

    @Delete('/index')
    @ApiQuery({ name: 'indexId', required: true })
    async deleteIndex(@Query('indexId') indexId: string) {
        return this.indexerService.delete(indexId, null);
    }


    // INDEX ITEM-WISE OPERATIONS

    @Put('/item')
    @ApiQuery({ name: 'indexItemId', required: false })
    // TODO: Can update webpage without indexId -> must change content of indexes including webpage
    async createIndexItem(@Query('indexId') indexId: string, @Query('indexItemId') indexItemId: string, @Body() body: IndexUpdateBody) {
        return this.indexerService.update(indexId, indexItemId, body);
    }

    @Patch('/item')
    @ApiQuery({ name: 'indexItemId', required: true })
    async updateIndexItem(@Query('indexId') indexId: string, @Body() body: IndexUpdateQuery) {
        // return this.indexerService.update(indexId, null, body);
    }

    @Delete('/item')
    @ApiQuery({ name: 'indexItemId', required: true })
    async deleteIndexItem(@Query('indexId') indexId: string, @Query('indexItemId') indexItemId: string) {
        return this.indexerService.delete(indexId, indexItemId);
    }

}