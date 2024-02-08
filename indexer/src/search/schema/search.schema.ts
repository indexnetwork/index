import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsNumber, IsString, Max, Min, Validate, ValidateNested } from "class-validator";


export class QueryRequestDTO {

    @ApiProperty({
        description: 'Compose index ids which the query will be executed on',
        example: ['id_1', 'id_2']
    })
    @IsString({ each: true })
    indexIds: string[];

    @ApiProperty({
        description: 'Question to ask',
        example: 'Audio models',
    })
    @IsString()
    query: string;

    @ApiProperty({
        description: 'Page number of the query',
        example: 1
    })
    @IsNumber()
    @Min(0)
    @Max(100)
    page: number;

    @ApiProperty({
        description: 'Number of documents to skip',
        example: 0,
        default: 10
    })
    @IsNumber()
    @Min(0)
    @Max(100)
    limit: number;

    @ApiPropertyOptional({
        description: 'ChromaDB query filters for metadata',
        example: { indexCreatedAt: { $gte: new Date('2021-01-01') } }
    })
    filters: any;

    @ApiPropertyOptional({
        description: 'Model type to be used',
        example: 'OpenAI'
    })
    model: string;

    @ApiPropertyOptional({ 
        description: 'Sort the documents by a field',
        example: 'webPageUpdatedAt'
    })
    sort: string;

    @ApiPropertyOptional({
        description: 'Sort the documents in descending order',
        example: false 
    })
    desc: boolean;


    @ApiPropertyOptional({
        description: 'Chain type to be used',
        example: 'query-v0'
    })
    chainType: string;
        
}


export class SearchRequestDTO {

    @ApiProperty({
        description: 'Embedding of the query',
        example: [0.1, 0.2, 0.3],
    })
    embedding: number[];

    @ApiProperty({
        description: 'Page number of the query',
        example: 1
    })
    @IsNumber()
    @Min(0)
    @Max(100)
    page: number;

    @ApiProperty({
        description: 'Number of documents to skip',
        example: 0
    })
    @IsNumber()
    @Min(0)
    @Max(100)
    skip: number;

    @ApiPropertyOptional({
        description: 'ChromaDB query filters for metadata',
        example: { indexCreatedAt: { $gte: new Date('2021-01-01') } }
    })
    filters: any;

    @ApiPropertyOptional({
        description: 'Model type to be used',
        example: 'OpenAI'
    })
    model: string;

    @ApiPropertyOptional({ 
        description: 'Sort the documents by a field',
        example: 'webPageUpdatedAt'
    })
    sort: string;

    @ApiPropertyOptional({
        description: 'Sort the documents in descending order',
        example: false 
    })
    desc: boolean;

    @ApiPropertyOptional({
        description: 'Chain type to be used',
        example: 'query-v0'
    })
    chainType: string;
}