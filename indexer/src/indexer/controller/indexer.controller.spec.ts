import { Test, TestingModule } from '@nestjs/testing';
import { IndexerController } from './indexer.controller';

describe('IndexerController', () => {
  let controller: IndexerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IndexerController],
    }).compile();

    controller = module.get<IndexerController>(IndexerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
