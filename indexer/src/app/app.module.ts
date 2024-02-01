import { Module } from '@nestjs/common';
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

@Module({
  imports: [

    ConfigModule.forRoot(),
    HttpModule,

    ChromaModule.register(process.env.OPENAI_API_KEY),
    AgentModule.register(),

    // TODO: Add event streamer to agents
    // ClientsModule.register([{
		// 	name: 'KAFKA_SERVICE',
		// 	transport: Transport.KAFKA,
		// 	options: {
		// 		client: {
		// 			clientId: 'indexer',
		// 			brokers: [process.env.INDEXER_KAFKA_URI],
		// 		},
		// 		consumer: {
		// 			groupId: 'indexer-agent',
		// 		},
		// 	},
		// }]),

  ],
  controllers: [
    AppController, 
    IndexerController, 
    ChatController
  ],
  providers: [
    AppService, 
    ChatService, 
    IndexerService
  ],
})
export class AppModule {}
