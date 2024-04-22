import { BaseMessage } from '@langchain/core/messages';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';

export enum RetrievalChainType {
    'rag-v0' = 'rag-v0',
}

export enum QueryChainType {
    'query-v0' = 'query-v0',
}

export enum ModelType {
    'OpenAI' = 'OpenAI',
    'MistralAI' = 'MistralAI',
}

export class ConversationalRetrievalQAChainInput {

    @ApiProperty({
        description: 'Question to ask',
        example: 'Summarize my documents',
    })
    question: string;

    @ApiProperty({
        description: 'Previous chat history',
        example: []
    })
    chat_history: [];
}

export class RetrievalDocumentInput {
    document: string;
}   


export class QuestionGenerationInput {

    @ApiProperty({
        description: 'Index to use',
        example: 'id_1' 
    })
    @IsString()
    indexIds: string;

}

export class RetrievalQuestionInput {

    @ApiPropertyOptional({
        description: 'Type of model in use',
        example: 'OpenAI',
        default: 'OpenAI',
    })
    @IsString()
    @IsEnum(ModelType)
    model_type: string = 'OpenAI';

    @ApiProperty({
        description: 'Index to use',
        example: ['id_1']
    })
    @IsString({each: true})
    indexIds: string[];

    @ApiPropertyOptional({
        description: 'Chain type to be used',
        example: 'rag-v0',
        default: 'rag-v0',
        required: false,
    })
    @IsString()
    @IsEnum(RetrievalChainType)
    chain_type: string = 'rag-v0';

    @ApiProperty({
        description: 'Chain input',
        example: {
            question: 'Summarize my documents',
            chat_history: []
        }
    })
    input: { question: string, chat_history: [] };

    @ApiPropertyOptional({
        description: 'Model arguments',
        example: {
            temperature: 0.0,
            maxTokens: 1000,
            maxRetries: 5
        }
    })
    model_args: any;
}   




