import { Body, Controller, Get, Logger, Post, RequestMethod, Res, StreamableFile } from '@nestjs/common';
import { ChatService } from '../service/chat.service';
import { RetrievalQuestionInput } from '../schema/chat.schema';
import { ApiBody } from '@nestjs/swagger';

@Controller('chat')
export class ChatController {

    constructor(private readonly chatService: ChatService) {}

    @ApiBody({ type: RetrievalQuestionInput })
    @Post('/stream')
    async stream(@Body() body: RetrievalQuestionInput, @Res() res: any){

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Encoding', 'none');

        Logger.log(`Processing ${JSON.stringify(body)}`, 'chatController:stream')
        const stream = await this.chatService.stream(body);

        for await (const chunk of stream) {
            res.write(JSON.stringify({
                ops: [
                    {
                        op: 'add',
                        path: '/stream',
                        value: chunk
                    }
                ]   
            })+ '\n')
        }

        res.end();
    }    
    
}


