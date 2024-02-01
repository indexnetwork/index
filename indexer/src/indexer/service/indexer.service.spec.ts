import { Test, TestingModule } from '@nestjs/testing';
import { IndexerService } from './indexer.service';

describe('IndexerService', () => {
  let service: IndexerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IndexerService],
    }).compile();

    service = module.get<IndexerService>(IndexerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
