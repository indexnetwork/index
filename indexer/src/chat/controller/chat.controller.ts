import { Body, Controller, Get, Logger, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ChatService } from '../service/chat.service';
import { QueryQuestionInput, RetrievalQuestionInput } from '../schema/chat.schema';

@Controller('chat')
export class ChatController {

    constructor(private readonly chatService: ChatService) {}

    @Post('/stream')
    async stream(@Body() body: RetrievalQuestionInput) {
        Logger.log(`Processing ${JSON.stringify(body)}`, 'chatController:stream')
        return this.chatService.stream(body);
    }
    
    @Post('/query')
    async query(@Body() body: QueryQuestionInput) {
        return this.chatService.query(body);
    }

}
