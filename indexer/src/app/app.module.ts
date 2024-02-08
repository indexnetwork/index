import { Module, Search } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IndexerController } from '../indexer/controller/indexer.controller';
import { ChatController } from '../chat/controller/chat.controller';
import { ChatService } from '../chat/service/chat.service';
import { ChromaModule } from './modules/chroma.module';
import { ConfigModule } from '@nestjs/config';
import { IndexerService } from 'src/indexer/service/indexer.service';
import { HttpModule } from '@nestjs/axios';
import { AgentModule } from './modules/agent.module';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SearchController } from 'src/search/controller/search.controller';
import { SearchService } from 'src/search/service/search.service';

@Module({
  imports: [

    ConfigModule.forRoot(),
    HttpModule,

    ChromaModule.register(process.env.OPENAI_API_KEY),
    AgentModule.register(),

  ],
  controllers: [
    AppController, 
    IndexerController, 
    ChatController,
    SearchController
  ],
  providers: [
    AppService, 
    ChatService, 
    IndexerService,
    SearchService
  ],
})
export class AppModule {}
