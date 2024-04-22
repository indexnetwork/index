import { Body, Controller, Delete, Get, Logger, Patch, Post, Put, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { IndexerService } from '../service/indexer.service';
import { CrawlRequestBody, EmbeddingRequestBody, IndexDeleteQuery, IndexItemDeleteQuery, IndexRequestBody, IndexUpdateBody, IndexUpdateQuery } from '../schema/indexer.schema';
import { ChromaClient } from 'chromadb';
import { ApiQuery } from '@nestjs/swagger';

// Custom validation pipe
@Controller('indexer')
export class IndexerController {

    constructor(private readonly indexerService: IndexerService) {
    }

    @Post('/crawl')
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    async crawl(@Body() body: CrawlRequestBody) {
        return this.indexerService.crawl(body.url);
    }

    @Post('/embeddings')
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    async embeddings(@Body() body: EmbeddingRequestBody) {
        return this.indexerService.embed(body.content);
    }


    // INDEX-WISE OPERATIONS

    @Post('/index')
    @ApiQuery({ name: 'indexId', required: true })
    // @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    async updateIndex(@Query('indexId') indexId: string, @Body() body: any) {
        return this.indexerService.index(indexId, body);
    }

    @Delete('/index')
    @ApiQuery({ name: 'indexId', required: true })
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    async deleteIndex(@Query('indexId') indexId: string) {
        return this.indexerService.delete(indexId, null);
    }

    // INDEX ITEM-WISE OPERATIONS

    @Put('/item')
    @ApiQuery({ name: 'indexItemId', required: false })
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    // TODO: Can update webpage without indexId -> must change content of indexes including webpage
    async createIndexItem(@Query('indexId') indexId: string, @Query('indexItemId') indexItemId: string, @Body() body: IndexUpdateBody) {
        return this.indexerService.update(indexId, indexItemId, body);
    }

    @Patch('/item')
    @ApiQuery({ name: 'indexItemId', required: true })
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    async updateIndexItem(@Query('indexId') indexId: string, @Query('indexItemId') indexItemId: string, @Body() body: IndexUpdateBody) {
        return this.indexerService.update(indexId, indexItemId, body);
    }

    @Delete('/item')
    @ApiQuery({ name: 'indexItemId', required: true })
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    async deleteIndexItem(@Query('indexId') indexId: string, @Query('indexItemId') indexItemId: string) {
        Logger.log(`Deleting ${indexId} ${indexItemId}`, 'indexerController:deleteIndexItem');
        return this.indexerService.delete(indexId, indexItemId);
    }

}