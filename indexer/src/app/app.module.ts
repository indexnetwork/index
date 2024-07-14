import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IndexerController } from '../indexer/controller/indexer.controller';
import { ChatController } from '../chat/controller/chat.controller';
import { ChatService } from '../chat/service/chat.service';
import { ConfigModule } from '@nestjs/config';
import { IndexerService } from 'src/indexer/service/indexer.service';
import { HttpModule } from '@nestjs/axios';
import { AgentModule } from './modules/agent.module';

@Module({
  imports: [ConfigModule.forRoot(), HttpModule, AgentModule.register()],
  controllers: [AppController, IndexerController, ChatController],
  providers: [AppService, ChatService, IndexerService],
})
export class AppModule {}
