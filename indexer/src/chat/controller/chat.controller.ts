import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import { ChatService } from '../service/chat.service';
import {
  QuestionGenerationInput,
  RetrievalQuestionInput,
} from '../schema/chat.schema';
import { ApiBody } from '@nestjs/swagger';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @ApiBody({ type: RetrievalQuestionInput })
  @Post('/external')
  async dynamic(@Body() body: any, @Res() res: any) {
    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Content-Encoding', 'none');

      // Logger.log(`Processing ${JSON.stringify(body)}`, 'chatController:stream');
      const stream = await this.chatService.streamExternal(body);

      for await (const chunk of stream) {
        chunk && res.write(chunk);
      }

      res.end();
    } catch (e) {
      console.error(e);
    }
  }
}
