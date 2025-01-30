import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IndexerController } from '../indexer/controller/indexer.controller';
import { ConfigModule } from '@nestjs/config';
import { IndexerService } from 'src/indexer/service/indexer.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [ConfigModule.forRoot(), HttpModule],
  controllers: [AppController, IndexerController],
  providers: [AppService, IndexerService],
})
export class AppModule {}
