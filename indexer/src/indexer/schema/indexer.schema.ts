import { Embeddings } from "@langchain/core/embeddings";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsUrl, Matches, MaxLength, MinLength, Validate, ValidateNested } from "class-validator";


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

export enum MetadataFields {
    'indexId'= 'indexId',
    'indexTitle'= 'indexTitle',
    'indexCreatedAt'= 'indexCreatedAt',
    'indexUpdatedAt'= 'indexUpdatedAt',
    'indexDeletedAt'= 'indexDeletedAt',
    'indexOwnerDID'= 'indexOwnerDID',
    'webPageId'='webPageId',
    'webPageTitle'='webPageTitle',
    'webPageUrl'='webPageUrl',
    'webPageContent'='webPageContent',
    'webPageCreatedAt'='webPageCreatedAt',
    'webPageUpdatedAt'='webPageUpdatedAt',
    'webPageDeletedAt'='webPageDeletedAt',
    'vector' = 'vector'
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

export class IndexRequestBody {

    @ApiProperty({
        description: 'Index title',
        example: 'test',
    })
    @Type(() => String)
    @MinLength(1)
    @MaxLength(100)
    indexTitle: string;

    @ApiProperty({
        description: 'Date of index creation',
        example: 'test',
    })
    @Type(() => Date)
    indexCreatedAt: Date;

    @ApiProperty({
        description: 'Date of last update of the index',
        example: 'test',
    })
    @Type(() => Date)
    indexUpdatedAt: Date;

    @ApiProperty({
        description: 'DID Info of the index owner',
        example: ''
    })
    @Type(() => String)
    // @Matches(/^[a-zA-Z0-9]+$/) // TODO: Write appropriate regex
    indexOwnerDID: string;
    
    @ApiPropertyOptional({
        description: 'Name of the index owner',
        example: ''
    })
    @Type(() => String)
    indexOwnerName: string | null;

    @ApiPropertyOptional({
        description: 'Biography of the index owner',
        example: ''
    })
    @Type(() => String)
    indexOwnerBio: string | null;

    @ApiProperty({
        description: 'Indexed id of web page',
        example: ''
    })
    @Type(() => String)
    // @Matches(/^[a-zA-Z0-9]+$/) // TODO: Write appropriate regex
    webPageId: string;

    @ApiProperty({
        description: 'Named title of the web page', // Is it named by user or html content
        example: 'test',
    })
    @Type(() => String)
    @MinLength(1)
    @MaxLength(100)    
    webPageTitle: string;

    @ApiProperty({
        description: 'Url of the indexed web page',
        example: ''
    })
    @IsUrl()
    @Type(() => String)
    webPageUrl: string;

    @ApiProperty({
        description: 'Web page content',
        example: ''
    })
    @Type(() => String)
    webPageContent: string;

    @ApiProperty({
        description: 'Date of web page indexing',
        example: 'test',
    })
    @Type(() => Date)
    webPageCreatedAt: Date;


    @ApiProperty({
        description: 'Date of last update of the indexed web page',
        example: 'test',
    })
    @Type(() => Date)
    webPageUpdatedAt: Date;

    // TODO: Check input?
    @ApiProperty({
        description: 'OpenAI Embedding of the indexed web page content',
    })
    vector: number[];
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