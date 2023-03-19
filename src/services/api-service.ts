import axios from "axios";
import { appConfig } from "config";
import {
	Indexes, Links, UserIndex,
} from "types/entity";
import { API_ENDPOINTS } from "utils/constants";

export type HighlightType<T = {}> = T & {
	highlight?: { [key: string]: string[] }
};
export interface IndexResponse extends Indexes {
  highlight?: HighlightType;
}
export interface IndexSearchResponse {
	starred?: {
		totalCount: number;
		records: Indexes[];
	},
	my_indexes?: {
		totalCount: number;
		records: Indexes[];
	}
}

export interface LinkSearchRequestBody extends ApiSearchRequestBody<{}> {
	index_id: string;
	skip: number;
	take: number;
	search?: string;
}

export interface GetUserIndexesRequestBody {
	did: string;
	index_id: string;
}

export interface DidSearchRequestBody extends ApiSearchRequestBody<{}> {
	did: string;
	skip: number;
	take: number;
	search?: string;
	links_size?: number;
	type?: string;
}
export interface DidSearchResponse {
	totalCount: number;
	records: Indexes[];
}

export interface LinkSearchResponse {
	totalCount: number;
	records: Links[];
}
export interface UserIndexResponse {
	my_indexes?: UserIndex;
	starred?: UserIndex;
}

export type SortType = "asc" | "desc";

export type ObjectFromKeys<T, V> = {
	[K in keyof T]: V;
};
export interface BaseRequestFilterParams<T = {}> {
	startDate?: Date;
	endDate?: Date;
	id?: number[] | string[];
	search?: string;
	sort?: ObjectFromKeys<T, SortType>;
}

export interface BaseRequestPaginationParams {
	skip?: number;
	take?: number;
}

export type ApiFilteredRequestBody<T = {}> = T & BaseRequestFilterParams<T>;

export type ApiPaginatedRequestBody<T = {}> = T & BaseRequestPaginationParams;
export type ApiSearchRequestBody<S = {}> = Partial<Omit<S, "id">> & BaseRequestFilterParams<S> & BaseRequestPaginationParams;

export interface IndexesSearchRequestBody extends ApiSearchRequestBody<Indexes> {
	// permission: IndexSearchRequestType;
}

export interface LinksCrawlContentRequest {
	id: string;
	links: Links[];
}

const apiAxios = axios.create({
	baseURL: appConfig.apiUrl,
});

class ApiService {

	async searchIndex(body: DidSearchRequestBody): Promise<IndexSearchResponse | null> {
		try {
			const { data } = await apiAxios.post<IndexSearchResponse>(API_ENDPOINTS.SEARCH_DID, body);
			return data;
		} catch (err) {
			return null;
		}
	}



	async getUserIndexes(body: GetUserIndexesRequestBody): Promise<UserIndexResponse | undefined> {
		try {
			const { data } = await apiAxios.post<UserIndexResponse>(API_ENDPOINTS.GET_USER_INDEXES, body);
			return data;
		} catch (err) {
			// TODO handle;
		}
	}
	async getIndexById(index_id: string) : Promise<Indexes | undefined> {
		try {
			const { data } = await apiAxios.get(`${API_ENDPOINTS.INDEXES}/${index_id}`);
			return data as Indexes;
		} catch (err: any) {
			throw new Error(err.message);
		}
	}

	async crawlLink(url: string): Promise<Links | null> {
		try {
			const { data } = await apiAxios.get<Links>(API_ENDPOINTS.CRAWL, {
				params: {
					url,
				},
			});
			return data;
		} catch (err) {
			return null;
		}
	}
	async searchLink(body: LinkSearchRequestBody): Promise<LinkSearchResponse | null> {
		try {
			const { data } = await apiAxios.post<LinkSearchResponse>(API_ENDPOINTS.SEARCH_LINKS, body);
			return data;
		} catch (err) {
			return null;
		}
	}
}

const api = new ApiService();
export default api;
