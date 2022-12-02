import axios from "axios";
import { appConfig } from "config";
import {
	Indexes, LinkContentResult, Links, SyncCompleteResult,
} from "types/entity";
import { API_ENDPOINTS } from "utils/constants";
import { checkPublicRoute } from "utils/helper";

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
const hostnameCheck = () =>{
	if (typeof window !== 'undefined') {
		if(window.location.hostname === "testnet.index.as" || window.location.hostname === "localhost"){
			return appConfig.apiUrl;
		}
		else if(window.location.hostname === "dev.index.as"){
			return appConfig.devApiUrl;
		}
	  } 
}
const apiAxios = axios.create({
	baseURL: hostnameCheck(),
});

apiAxios.interceptors.request.use((config) => {
	const token = localStorage.getItem("auth_token");
	if (!token && !checkPublicRoute(config.url!)) {
		return false;
	}

	if (config && config.headers && token) {
		config.headers.Authorization = `Bearer ${token}`;
	}
	return config;
});
class ApiService {
	async postIndex(doc: Indexes): Promise<Indexes | null> {
		try {
			const { data } = await apiAxios.post<Indexes>(API_ENDPOINTS.INDEXES, doc);
			return data;
		} catch (err) {
			return null;
		}
	}

	async putIndex(doc: Indexes): Promise<Indexes | null> {
		try {
			const { data } = await apiAxios.put<Indexes>(API_ENDPOINTS.INDEXES, doc);
			return data;
		} catch (err) {
			return null;
		}
	}

	async searchIndex(body: IndexesSearchRequestBody): Promise<IndexSearchResponse | null> {
		try {
			const { data } = await apiAxios.post<IndexSearchResponse>(API_ENDPOINTS.SEARCH_INDEX, body);
			return data;
		} catch (err) {
			return null;
		}
	}

	async getIndex(streamId: string): Promise<Indexes | null> {
		try {
			const { data } = await apiAxios.get<Indexes>(`${API_ENDPOINTS.INDEXES}/${streamId}`);
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

	async searchLink(body: LinksSearchRequestBody): Promise<LinkSearchResponse | null> {
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
