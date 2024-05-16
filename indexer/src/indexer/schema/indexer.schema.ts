import { Embeddings } from "@langchain/core/embeddings";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsUrl, Matches, MaxLength, MinLength, Validate, ValidateNested } from "class-validator";
import exp from "constants";


export enum  MIME_TYPE {
    'text/csv'='csv',
    'application/epub+zip'='epub',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'='xlsx',
    'application/vnd.ms-excel'='xls',
    'text/html'='html',
    'text/markdown'='md',
    'text/org'='org',
    'application/vnd.oasis.opendocument.text'='odt',
    'application/pdf'='pdf',
    'text/plain'='txt',
    'application/vnd.ms-powerpoint'='ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'='pptx',
    'text/rtf'='rtf',
    'text/tab-separated-values'='tsv',
    'application/msword'='doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'='docx',
    'application/xml'='xml',
    'application/json'='json'
}

export class IndexRequestBody {
    
    @ApiProperty({
        description: 'Id of the index',
        example: '',
    })
    @Type(() => String)
    // @Matches(/^[a-zA-Z0-9]+$/) // TODO: Write appropriate regex
    indexId: string;

    @ApiPropertyOptional({
        description: 'Embedding of the document',
        default: null
    })
    embedding: [number[]] | null;
}


export class CrawlRequestBody {
    
    @ApiProperty({
        description: 'Url to crawl',
        example: 'https://google.com',
    })
    @IsUrl()
    url: string;
    
}

export class IndexUpdateQuery {

    @ApiProperty({
        description: 'ChromaDB ids of the update document',
        examples: ['id_1']
    })
    @Type(() => String)
    // @Matches(/^[a-zA-Z0-9]+$/) // TODO: Write appropriate regex
    indexId: string;

    @ApiProperty({
        description: 'ChromaDB ids of the update document',
        examples: ['id_1']
    })
    @Type(() => String)
    // @Matches(/^[a-zA-Z0-9]+$/) // TODO: Write appropriate regex
    indexItemId: string;

}

export class IndexUpdateBody {

    @ApiPropertyOptional({
        description: '',
        default: null
    })
    embedding: [number[]] | null;

    @ApiPropertyOptional({
        description: 'Key-value pairs for updated field values of the document',
        default: null
    })
    // @ValidateNested(() => ) // TODO: Check if appropriate fields
    metadata: Object | null;

    @ApiPropertyOptional({
        description: 'Documents of the',
        default: null
    })
    documents: string | string[] | null;

}

export class IndexDeleteQuery {

    @ApiProperty({
        description: 'ChromaDB ids of the update document',
        examples: ['id_1']
    })
    @Type(() => String)
    // @Matches(/^[a-zA-Z0-9]+$/) // TODO: Write appropriate regex
    indexId: string;

}


export class IndexItemDeleteQuery extends IndexDeleteQuery {

    @ApiPropertyOptional({
        description: 'ChromaDB ids of the update document',
        examples: ['id_1']
    })
    @Type(() => String)
    // @Matches(/^[a-zA-Z0-9]+$/) // TODO: Write appropriate regex
    indexItemId: string;

}


export class EmbeddingRequestBody {
    @ApiProperty({
        description: 'Content to embed',
        example: 'test',
    })
    @Type(() => String)
    @MinLength(1)
    @MaxLength(1_000_000)
    content: string;
}