import axios from "axios";
import { appConfig } from "config";
import {
	Indexes, LinkContentResult, Links, SyncCompleteResult,
} from "types/entity";
import { API_ENDPOINTS } from "utils/constants";

export type HighlightType<T = {}> = T & {
	highlight?: { [key: string]: string[] }
};
export interface IndexResponse extends Indexes {
  highlight?: HighlightType;
}
export interface IndexSearchResponse {
	totalCount: number;
	records: Indexes[];
}

export interface LinkSearchRequestBody extends ApiSearchRequestBody<{}> {
	index_id: string;
	skip: number;
	take: number;
	search?: string;
}

export interface DidSearchRequestBody extends ApiSearchRequestBody<{}> {
	did: string;
	skip: number;
	take: number;
	search?: string;
	links_size?: number;
}
export interface DidSearchResponse {
	totalCount: number;
	records: Indexes[];
}

export interface LinkSearchResponse {
	totalCount: number;
	records: Links[];
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
	async putIndex(doc: Indexes): Promise<Indexes | null> {
		try {
			const { data } = await apiAxios.put<Indexes>(API_ENDPOINTS.INDEXES, doc);
			return data;
		} catch (err) {
			return null;
		}
	}

	async searchIndex(body: DidSearchRequestBody): Promise<IndexSearchResponse | null> {
		try {
			const { data } = await apiAxios.post<IndexSearchResponse>(API_ENDPOINTS.SEARCH_DID, body);
			return data;
		} catch (err) {
			return null;
		}
	}

	async deleteIndex(streamId: string): Promise<boolean> {
		try {
			await apiAxios.delete(`${API_ENDPOINTS.INDEXES}/${streamId}`);
			return true;
		} catch (err) {
			return false;
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

	async crawlLinkContent(dt: LinksCrawlContentRequest): Promise<boolean> {
		try {
			await apiAxios.post(API_ENDPOINTS.CRAWL_CONTENT, dt);
			return true;
		} catch (err) {
			return false;
		}
	}

	async findLinkContent(): Promise<LinkContentResult[] | null> {
		try {
			const { data } = await apiAxios.get<LinkContentResult[]>(API_ENDPOINTS.FIND_CONTENT);
			return data;
		} catch (err) {
			return null;
		}
	}

	async completeSync(ids: string[]): Promise<SyncCompleteResult | null> {
		try {
			const { data } = await apiAxios.post<SyncCompleteResult>(API_ENDPOINTS.SYNC_CONTENT, {
				ids,
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
