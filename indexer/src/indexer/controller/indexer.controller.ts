import {
  Body,
  Controller,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IndexerService } from '../service/indexer.service';
import {
  CrawlRequestBody,
  EmbeddingRequestBody,
} from '../schema/indexer.schema';

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
}
