import axios from "axios";
import {
	Indexes, LinkContentResult, Links, SyncCompleteResult,
} from "types/entity";

export type HighlightType<T = {}> = T & {
	highlight?: { [key: string]: string[] }
};
export interface IndexResponse extends Indexes {
  highlight?: HighlightType;
}
export interface ListResponse<T, S> {
	totalCount?: number;
  records?: T[];
  search?: S;
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

export interface IndexSearchResponse extends ListResponse<IndexResponse, IndexesSearchRequestBody> {}

export interface LinksSearchRequestBody extends ApiSearchRequestBody<{}> {
	streamId: string;
	search: string;
}

export interface LinkSearchResponse extends ListResponse<Links, LinksSearchRequestBody>{}

export interface LinksCrawlContentRequest {
	streamId: string;
	links: Links[];
}

const API_URL = "https://testnet.index.as/api";
// const API_URL = "http://localhost:3001";

const apiAxios = axios.create({
	baseURL: API_URL,
});

apiAxios.interceptors.request.use((config) => {
	const token = localStorage.getItem("auth_token");
	if (!token) {
		return false;
	}
	if (config && config.headers) {
		config.headers.Authorization = `Bearer ${token}`;
	}
	return config;
});

const ENDPOINTS = {
	INDEXES: "/indexes",
	SEARCH_INDEX: "/indexes/search",
	CRAWL: "/links/crawl",
	CRAWL_CONTENT: "/links/crawl-content",
	FIND_CONTENT: "/links/find-content",
	SYNC_CONTENT: "/links/sync-content",
	SEARCH_LINKS: "/links/search",
};

class ApiService {
	async postIndex(doc: Indexes): Promise<Indexes | null> {
		try {
			const { data } = await apiAxios.post<Indexes>(ENDPOINTS.INDEXES, doc);
			return data;
		} catch (err) {
			return null;
		}
	}

	async putIndex(doc: Indexes): Promise<Indexes | null> {
		try {
			const { data } = await apiAxios.put<Indexes>(ENDPOINTS.INDEXES, doc);
			return data;
		} catch (err) {
			return null;
		}
	}

	async searchIndex(body: IndexesSearchRequestBody): Promise<IndexSearchResponse | null> {
		try {
			const { data } = await apiAxios.post<IndexSearchResponse>(ENDPOINTS.SEARCH_INDEX, body);
			return data;
		} catch (err) {
			return null;
		}
	}

	async getIndex(streamId: string): Promise<Indexes | null> {
		try {
			const { data } = await apiAxios.get<Indexes>(`${ENDPOINTS.INDEXES}/${streamId}`);
			return data;
		} catch (err) {
			return null;
		}
	}

	async deleteIndex(streamId: string): Promise<boolean> {
		try {
			await apiAxios.delete(`${ENDPOINTS.INDEXES}/${streamId}`);
			return true;
		} catch (err) {
			return false;
		}
	}

	async crawlLink(url: string): Promise<Links | null> {
		try {
			const { data } = await apiAxios.get<Links>(ENDPOINTS.CRAWL, {
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
			await apiAxios.post(ENDPOINTS.CRAWL_CONTENT, dt);
			return true;
		} catch (err) {
			return false;
		}
	}

	async findLinkContent(): Promise<LinkContentResult[] | null> {
		try {
			const { data } = await apiAxios.get<LinkContentResult[]>(ENDPOINTS.FIND_CONTENT);
			return data;
		} catch (err) {
			return null;
		}
	}

	async completeSync(ids: string[]): Promise<SyncCompleteResult | null> {
		try {
			const { data } = await apiAxios.post<SyncCompleteResult>(ENDPOINTS.SYNC_CONTENT, {
				ids,
			});
			return data;
		} catch (err) {
			return null;
		}
	}

	async searchLink(body: LinksSearchRequestBody): Promise<LinkSearchResponse | null> {
		try {
			const { data } = await apiAxios.post<LinkSearchResponse>(ENDPOINTS.SEARCH_LINKS, body);
			return data;
		} catch (err) {
			return null;
		}
	}
}

const api = new ApiService();
export default api;
