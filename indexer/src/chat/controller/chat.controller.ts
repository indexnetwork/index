import { Body, Controller, Get, Logger, Post } from '@nestjs/common';
import { ChatService } from '../service/chat.service';
import { RetrievalQuestionInput } from '../schema/chat.schema';
import { ApiBody } from '@nestjs/swagger';

@Controller('chat')
export class ChatController {

    constructor(private readonly chatService: ChatService) {}

    @ApiBody({ type: RetrievalQuestionInput })
    @Post('/stream')
    async stream(@Body() body: RetrievalQuestionInput) {
        Logger.log(`Processing ${JSON.stringify(body)}`, 'chatController:stream')
        return this.chatService.stream(body);
    }    
    
}
