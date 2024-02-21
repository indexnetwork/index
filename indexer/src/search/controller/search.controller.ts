import { Body, Controller, HttpStatus, Post, Query, ValidationPipe } from '@nestjs/common';
import { SearchService } from '../service/search.service';
import { Stream } from 'stream';
import { ApiPropertyOptional, ApiQuery } from '@nestjs/swagger';
import { AutocompleteRequestDTO, QueryRequestDTO, SearchRequestDTO } from '../schema/search.schema';

@Controller('search')
export class SearchController {

    constructor(private readonly searchService: SearchService) {}

    @Post('/query')
    async query(@Body() body: QueryRequestDTO ) {
        return this.searchService.query(body);
    }

    @Post('/search')
    async search(@Body() body: SearchRequestDTO ) {
        return HttpStatus.NOT_IMPLEMENTED;
    }

    @Post('/autocomplete')
    async autocomplete(@Body() body: AutocompleteRequestDTO ) {
        return this.searchService.autocomplete(body);
    }

}
