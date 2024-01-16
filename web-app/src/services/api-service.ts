import axios from "axios";
import { appConfig } from "config";
import {
	Indexes, IndexLink, Link, UserIndex,
} from "types/entity";
import { API_ENDPOINTS } from "utils/constants";
import { CID } from "multiformats";

export type HighlightType<T = {}> = T & {
	highlight?: { [key: string]: string[] }
};
export interface IndexResponse extends Indexes {
  highlight?: HighlightType;
}
export interface IndexSearchResponse {
	all: {
		totalCount: number;
		records: Indexes[];
	},
	owner?: {
		totalCount: number;
		records: Indexes[];
	}
	starred?: {
		totalCount: number;
		records: Indexes[];
	},
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
	owner?: UserIndex;
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

const buildHeaders = (personalSession?: string, pkpSession?: string): any => {
  return {
    "X-Index-Personal-DID-Session": personalSession,
    "X-Index-PKP-DID-Session": pkpSession,
  }
}

const apiAxios = axios.create({
	baseURL: appConfig.apiUrl,
});

class ApiService {
  async createIndex({
    params, pkpSession, personalSession
  }: {
    params: Partial<Indexes>, pkpSession: string, personalSession: string
  }): Promise<Indexes> {
    const { data } = await apiAxios.post<any>('/indexes', params, {
      headers: buildHeaders(personalSession, pkpSession)
    });
    return data;
  }

	async getAllIndexes(id: string): Promise<Indexes[]> {
		const url = API_ENDPOINTS.GET_ALL_INDEXES.replace(':id', id);
		const { data } = await apiAxios.get<Indexes[]>(url);
		return data;
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
			// throw new Error(err.message);
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
	async getLITAction(cid: string): Promise<LitActionConditions | null > {
		try {
			const { data } = await apiAxios.get<LitActionConditions>(`${API_ENDPOINTS.LIT_ACTIONS}/${cid}`);
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
			// eslint-disable-next-line max-len
			const { data } = await apiAxios.get<LitActionConditions>(tokenId ? `${API_ENDPOINTS.NFT_METADATA}/${network}/${address}/${tokenId}` : `${API_ENDPOINTS.NFT_METADATA}/${network}/${address}`);
			return data;
		} catch (err) {
			return null;
		}
	}
	async getWallet(ensName: string): Promise<any | null > {
		try {
			const { data } = await apiAxios.get<LitActionConditions>(`${API_ENDPOINTS.ENS}/${ensName}`);
			return data;
		} catch (err) {
			return null;
		}
	}
	async uploadAvatar(file: File): Promise<{ cid: CID } | null> {
		try {
			const formData = new FormData();
			formData.append("file", file);
			const { data } = await apiAxios.post<{ cid: CID }>(API_ENDPOINTS.UPLOAD_AVATAR, formData, {
				headers: {
					"Content-Type": "multipart/form-data",
				},
			});
			return data;
		} catch (err) {
			return null;
		}
	}
	async zapierTestLogin(email: string, password: string) : Promise<any | undefined> {
		try {
			const { data } = await apiAxios.post(`${API_ENDPOINTS.ZAPIER_TEST_LOGIN}`, { email, password });
			return data as any;
		} catch (err: any) {
			// throw new Error(err.message);
		}
	}
	async subscribeToNewsletter(email: string) : Promise<any | undefined> {
		try {
		  const { data } = await apiAxios.post(`${API_ENDPOINTS.SUBSCRIBE_TO_NEWSLETTER}`, { email });
		  return data;
		} catch (err: any) {
		  const errorMessage = err.response && err.response.data && err.response.data.message ?
		   err.response.data.message :
		   err.message;
		  throw new Error(errorMessage);
		}
	  }
}

const api = new ApiService();
export default api;
