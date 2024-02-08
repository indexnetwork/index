import { Body, Controller, Delete, Get, Post, Put, Query } from '@nestjs/common';
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

    @Post('/index')
    @ApiQuery({ name: 'indexId', required: true })
    async index(@Query('indexId') indexId: string, @Body() body: IndexRequestBody) {
        return this.indexerService.index(indexId, body);
    }

    @Put('/index')
    @ApiQuery({ name: 'indexId', required: true })
    @ApiQuery({ name: 'indexItemId', required: true })
    // TODO: Can update webpage without indexId -> must change content of indexes including webpage
    async update(@Query('indexId') indexId: string, @Query('indexItemId') indexItemId: string, @Body() body: IndexUpdateBody) {
        return this.indexerService.update(indexId, indexItemId, body);
    }

    @Delete('/index')
    @ApiQuery({ name: 'indexId', required: true })
    async deleteIndex(@Query('indexId') indexId: string) {
        return this.indexerService.delete(indexId, null);
    }

    @Delete('/item')
    @ApiQuery({ name: 'indexId', required: true })
    @ApiQuery({ name: 'indexItemId', required: true })
    async deleteItem(@Query('indexId') indexId: string, @Query('indexItemId') indexItemId: string) {
        return this.indexerService.delete(indexId, indexItemId);
    }

}