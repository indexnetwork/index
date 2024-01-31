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

export class RetrievalQuestionInput {

    @ApiPropertyOptional({
        description: 'Type of model in use',
        example: 'OpenAI',
    })
    @IsString()
    @IsEnum(ModelType)
    model_type: string;

    @ApiProperty({
        description: 'Index to use',
        example: 'chroma-indexer',
    })
    @IsString()
    index_id: string | null;

    @ApiProperty({
        description: 'Chain type to be used',
        example: 'rag-v0',
    })
    @IsString()
    @IsEnum(RetrievalChainType)
    chain_type: string;

    @ApiProperty({
        description: 'Chain input',
        example: {
            question: 'Summarize my documents',
            chat_history: []
        }
    })
    input: { question: string, chat_history: [] };
    
}   


export class QueryQuestionInput {

    @ApiPropertyOptional({
        description: 'Type of model in use',
        example: 'OpenAI',
    })
    @IsString()
    @IsEnum(ModelType)
    model_type: string;

    @ApiProperty({
        description: 'Index to use',
        example: 'chroma-indexer',
    })
    @IsString()
    index_id: string | null;

    @ApiProperty({
        description: 'Chain type to be used',
        example: 'query-v0',
    })
    @IsString()
    @IsEnum(QueryChainType)
    chain_type: string;

    @ApiProperty({
        description: 'Query input for search in index',
        example: 'Documents about language modelling'
    })
    question: string;

    @ApiProperty({
        description: 'Number of documents to return',
        example: 10
    })
    k: number;

    @ApiProperty({
        description: 'The page of results to return',
        example: 0
    })
    page: number;

}   



