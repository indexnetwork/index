// import axios, { AxiosInstance } from "axios";
// import { appConfig } from "config";
// import { Indexes, IndexLink, Link, UserIndex, Users } from "types/entity";
// import { DEFAULT_CREATE_INDEX_TITLE } from "utils/constants";
// import { CID } from "multiformats";
// import LitService from "services/lit-service";
// import { DIDSession } from "did-session";

// export type HighlightType<T = {}> = T & {
//   highlight?: { [key: string]: string[] };
// };
// export interface IndexResponse extends Indexes {
//   highlight?: HighlightType;
// }

// export interface LinkSearchRequestBody extends ApiSearchRequestBody<{}> {
//   index_id: string;
//   skip: number;
//   take: number;
//   search?: string;
// }

// export interface GetUserIndexesRequestBody {
//   did: string;
//   index_id: string;
// }

// export interface DidSearchResponse {
//   totalCount: number;
//   records: Indexes[];
// }

// export interface LitActionConditions {}

// export interface LinkSearchResponse {
//   totalCount: number;
//   records: IndexLink[];
// }
// export interface UserIndexResponse {
//   owner?: UserIndex;
//   starred?: UserIndex;
// }

// export type SortType = "asc" | "desc";

// export type ObjectFromKeys<T, V> = {
//   [K in keyof T]: V;
// };
// export interface BaseRequestFilterParams<T = {}> {
//   startDate?: Date;
//   endDate?: Date;
//   id?: number[] | string[];
//   search?: string;
//   sort?: ObjectFromKeys<T, SortType>;
// }

// export interface BaseRequestPaginationParams {
//   skip?: number;
//   take?: number;
// }

// export type ApiFilteredRequestBody<T = {}> = T & BaseRequestFilterParams<T>;

// export type ApiPaginatedRequestBody<T = {}> = T & BaseRequestPaginationParams;
// export type ApiSearchRequestBody<S = {}> = Partial<Omit<S, "id">> &
//   BaseRequestFilterParams<S> &
//   BaseRequestPaginationParams;

// export interface IndexesSearchRequestBody
//   extends ApiSearchRequestBody<Indexes> {
//   // permission: IndexSearchRequestType;
// }

// export interface LinksCrawlContentRequest {
//   id: string;
//   links: Link[];
// }

// const API_ENDPOINTS = {
//   CHAT_STREAM: "/chat_stream",
//   INDEXES: "/indexes",
//   GET_ALL_INDEXES: "/dids/:id/indexes",
//   GET_PROFILE: "/dids/:id/profile",
//   SEARCH_LINKS: "/search/links",
//   GET_USER_INDEXES: "/search/user_indexes",
//   LIT_ACTIONS: "/lit_actions",
//   CRAWL: "/crawl/metadata",
//   CRAWL_CONTENT: "/links/crawl-content",
//   FIND_CONTENT: "/links/find-content",
//   SYNC_CONTENT: "/links/sync-content",
//   NFT_METADATA: "/nft",
//   ENS: "/ens",
//   UPLOAD_AVATAR: "/upload_avatar",
//   ZAPIER_TEST_LOGIN: "/zapier/test_login",
//   SUBSCRIBE_TO_NEWSLETTER: "/subscribe",
// };

// class ApiService {
//   private static instance: ApiService;
//   private apiAxios: AxiosInstance;
//   private signerPublicKey: Indexes["signerPublicKey"] = "";
//   private signerFunction: Indexes["signerFunction"] = appConfig.defaultCID;
//   private session: DIDSession | null = null;

//   private constructor() {
//     this.apiAxios = axios.create({ baseURL: appConfig.apiUrl });
//   }

//   public static getInstance(): ApiService {
//     if (!ApiService.instance) {
//       ApiService.instance = new ApiService();
//     }
//     return ApiService.instance;
//   }

//   public setSession(session: DIDSession) {
//     this.session = session;
//   }

//   async init(): Promise<void> {
//     const { pkpPublicKey } = await LitService.mintPkp();
//     this.signerPublicKey = pkpPublicKey;
//     console.log("pkpPublicKey:", pkpPublicKey);

//     // const sessionResponse = await LitService.getPKPSession(pkpPublicKey, appConfig.defaultCID);
//     // const personalSession = localStorage.getItem("did");
//     // if (!personalSession) {
//     //   throw new Error("No personal session found");
//     // }

//     // const pkpSession = sessionResponse.session.serialize();
//     // if (!pkpSession) {
//     //   throw new Error("Couldn't get PKP session");
//     // }

//     // this.apiAxios.defaults.headers = {
//     //   "X-Index-Personal-DID-Session": personalSession,
//     //   "X-Index-PKP-DID-Session": pkpSession,
//     // } as any;

//     this.apiAxios.defaults.headers = {
//       Authorization: `Bearer ${this.session}`,
//     } as any;
//   }

//   async getProfile(id: string): Promise<Users> {
//     const profile: Users = {
//       id: "k2t6wzhkhabz0l2fmm0auqvgfx6gmkvj9dz7nqz1h5cbmc7wf8lafucqply4yg",
//       bio: "hey",
//       avatar: undefined,
//       name: "serhat",
//       createdAt: "2024-01-18T12:13:05.493Z",
//       updatedAt: "2024-01-18T12:13:05.493Z",
//     };

//     const url = API_ENDPOINTS.GET_PROFILE.replace(":id", id);
//     const { data } = await this.apiAxios.get<Users>(url);
//     return data;
//   }

//   async createIndex(
//     title: string = DEFAULT_CREATE_INDEX_TITLE,
//   ): Promise<Indexes> {
//     const body = {
//       title,
//       signerPublicKey: this.signerPublicKey,
//       signerFunction: this.signerFunction,
//     };

//     const { data } = await this.apiAxios.post<Indexes>("/indexes", body);
//     return data;
//   }

//   // async getAllIndexes(): Promise<Indexes[]> {
//   //   const url = API_ENDPOINTS.GET_ALL_INDEXES.replace(':id', session.did.parent);
//   //   const { data } = await this.apiAxios.get<Indexes[]>(url);
//   //   return data;
//   // }

//   async getUserIndexes(
//     body: GetUserIndexesRequestBody,
//   ): Promise<UserIndexResponse | undefined> {
//     try {
//       const { data } = await this.apiAxios.post<UserIndexResponse>(
//         API_ENDPOINTS.GET_USER_INDEXES,
//         body,
//       );
//       return data;
//     } catch (err) {
//       // TODO handle;
//     }
//   }

//   async getIndexById(indexId: string): Promise<Indexes | undefined> {
//     try {
//       const { data } = await this.apiAxios.get(
//         `${API_ENDPOINTS.INDEXES}/${indexId}`,
//       );
//       return data as Indexes;
//     } catch (err: any) {
//       // throw new Error(err.message);
//     }
//   }
//   async crawlLink(url: string): Promise<Link | null> {
//     try {
//       const { data } = await this.apiAxios.get<Link>(API_ENDPOINTS.CRAWL, {
//         params: {
//           url,
//         },
//       });
//       return data;
//     } catch (err) {
//       return null;
//     }
//   }
//   async searchLink(
//     body: LinkSearchRequestBody,
//   ): Promise<LinkSearchResponse | null> {
//     try {
//       const { data } = await this.apiAxios.post<LinkSearchResponse>(
//         API_ENDPOINTS.SEARCH_LINKS,
//         body,
//       );
//       return data;
//     } catch (err) {
//       return null;
//     }
//   }
//   async getLITAction(cid: string): Promise<LitActionConditions | null> {
//     try {
//       const { data } = await this.apiAxios.get<LitActionConditions>(
//         `${API_ENDPOINTS.LIT_ACTIONS}/${cid}`,
//       );
//       return data;
//     } catch (err) {
//       return null;
//     }
//   }
//   async postLITAction(conditions: LitActionConditions): Promise<string | null> {
//     try {
//       const { data } = await this.apiAxios.post<LitActionConditions>(
//         `${API_ENDPOINTS.LIT_ACTIONS}`,
//         conditions,
//       );
//       return data as string;
//     } catch (err) {
//       return null;
//     }
//   }
//   async getContract(
//     network: string,
//     address: string,
//     tokenId?: string,
//   ): Promise<any | null> {
//     try {
//       // eslint-disable-next-line max-len
//       const { data } = await this.apiAxios.get<LitActionConditions>(
//         tokenId
//           ? `${API_ENDPOINTS.NFT_METADATA}/${network}/${address}/${tokenId}`
//           : `${API_ENDPOINTS.NFT_METADATA}/${network}/${address}`,
//       );
//       return data;
//     } catch (err) {
//       return null;
//     }
//   }
//   async getWallet(ensName: string): Promise<any | null> {
//     try {
//       const { data } = await this.apiAxios.get<LitActionConditions>(
//         `${API_ENDPOINTS.ENS}/${ensName}`,
//       );
//       return data;
//     } catch (err) {
//       return null;
//     }
//   }
//   async uploadAvatar(file: File): Promise<{ cid: CID } | null> {
//     try {
//       const formData = new FormData();
//       formData.append("file", file);
//       const { data } = await this.apiAxios.post<{ cid: CID }>(
//         API_ENDPOINTS.UPLOAD_AVATAR,
//         formData,
//         {
//           headers: {
//             "Content-Type": "multipart/form-data",
//           },
//         },
//       );
//       return data;
//     } catch (err) {
//       return null;
//     }
//   }
//   async zapierTestLogin(
//     email: string,
//     password: string,
//   ): Promise<any | undefined> {
//     try {
//       const { data } = await this.apiAxios.post(
//         `${API_ENDPOINTS.ZAPIER_TEST_LOGIN}`,
//         { email, password },
//       );
//       return data as any;
//     } catch (err: any) {
//       // throw new Error(err.message);
//     }
//   }
//   async subscribeToNewsletter(email: string): Promise<any | undefined> {
//     try {
//       const { data } = await this.apiAxios.post(
//         `${API_ENDPOINTS.SUBSCRIBE_TO_NEWSLETTER}`,
//         { email },
//       );
//       return data;
//     } catch (err: any) {
//       const errorMessage =
//         err.response && err.response.data && err.response.data.message
//           ? err.response.data.message
//           : err.message;
//       throw new Error(errorMessage);
//     }
//   }
// }

// export default ApiService;
