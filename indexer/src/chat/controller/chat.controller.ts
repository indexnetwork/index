import { Body, Controller, Get, Logger, Post, Query, RequestMethod, Res, StreamableFile } from '@nestjs/common';
import { ChatService } from '../service/chat.service';
import { QuestionGenerationInput, RetrievalQuestionInput } from '../schema/chat.schema';
import { ApiBody, ApiQuery } from '@nestjs/swagger';

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
            chunk.answer && res.write(chunk.answer)
        }

        res.end();
    }


    @Get('/generate')
    async generate(@Query('indexId') indexId: string): Promise<any> {
        Logger.log(`Generating question for ${JSON.stringify(indexId)}`, 'chatController:generate')
        return this.chatService.generate(indexId);
    }

}
