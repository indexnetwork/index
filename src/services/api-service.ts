import axios from "axios";
import { appConfig } from "config";
import {
	Indexes, IndexLink, Link, UserIndex,
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

export interface LitActionConditions {

}

export interface LinkSearchResponse {
	totalCount: number;
	records: IndexLink[];
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
	links: Link[];
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
	async getIndexById(indexId: string) : Promise<Indexes | undefined> {
		try {
			const { data } = await apiAxios.get(`${API_ENDPOINTS.INDEXES}/${indexId}`);
			return data as Indexes;
		} catch (err: any) {
			throw new Error(err.message);
		}
	}
	async crawlLink(url: string): Promise<Link | null> {
		try {
			const { data } = await apiAxios.get<Link>(API_ENDPOINTS.CRAWL, {
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
	async getLITAction(CID: string): Promise<LitActionConditions | null > {
		try {
			const { data } = await apiAxios.get<LitActionConditions>(`${API_ENDPOINTS.LIT_ACTIONS}/${CID}`);
			return data;
		} catch (err) {
			return null;
		}
	}
	async postLITAction(conditions: LitActionConditions): Promise<string | null > {
		try {
			const { data } = await apiAxios.post<LitActionConditions>(`${API_ENDPOINTS.LIT_ACTIONS}`, conditions);
			return data as string;
		} catch (err) {
			return null;
		}
	}
	async getContract(network: string, address: string, tokenId?: string): Promise<any | null > {
		try {
			const { data } = await apiAxios.get<LitActionConditions>(`${API_ENDPOINTS.NFT_METADATA}/${network}/${address}`);
			return data;
		} catch (err) {
			return null;
		}
	}
}

const api = new ApiService();
export default api;
