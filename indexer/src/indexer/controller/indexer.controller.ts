import {
  Body,
  Controller,
  Delete,
  Logger,
  Patch,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IndexerService } from '../service/indexer.service';
import {
  CrawlRequestBody,
  EmbeddingRequestBody,
  IndexUpdateBody,
} from '../schema/indexer.schema';
import { ApiQuery } from '@nestjs/swagger';

// Custom validation pipe
@Controller('indexer')
export class IndexerController {
  constructor(private readonly indexerService: IndexerService) {}

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
  async updateIndex(@Body() body: any) {
    return this.indexerService.index(body);
  }

  @Delete('/index')
  @ApiQuery({ name: 'indexId', required: true })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async deleteIndex(@Query('indexId') indexId: string) {
    return this.indexerService.deleteIndex(indexId);
  }

  // INDEX ITEM-WISE OPERATIONS

  @Put('/item')
  @ApiQuery({ name: 'itemId', required: true })
  @ApiQuery({ name: 'indexId', required: true })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  // TODO: Can update webpage without indexId -> must change content of indexes including webpage
  async createIndexItem(
    @Query('indexId') indexId: string,
    @Query('itemId') itemId: string,
    @Body() body: IndexUpdateBody,
  ) {
    return this.indexerService.update(indexId, itemId, body);
  }

  @Patch('/item')
  @ApiQuery({ name: 'indexId', required: true })
  @ApiQuery({ name: 'itemId', required: true })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async updateIndexItem(
    @Query('indexId') indexId: string,
    @Query('itemId') itemId: string,
    @Body() body: IndexUpdateBody,
  ) {
    return this.indexerService.update(indexId, itemId, body);
  }

  @Delete('/item')
  @ApiQuery({ name: 'indexId', required: true })
  @ApiQuery({ name: 'itemId', required: true })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async deleteIndexItem(
    @Query('indexId') indexId: string,
    @Query('itemId') itemId: string,
  ) {
    Logger.log(
      `Deleting ${indexId} ${itemId}`,
      'indexerController:deleteIndexItem',
    );
    return this.indexerService.deleteIndexItem(indexId, itemId);
  }
}
