// ApiService.ts

import axios, { AxiosInstance } from 'axios';
import { AuthContext } from 'components/site/context/AuthContext';
import { appConfig } from 'config';
import { DIDSession } from 'did-session';
import { useContext } from 'react';
import { Indexes, Link, Users } from 'types/entity';
import { DEFAULT_CREATE_INDEX_TITLE } from 'utils/constants';
import { LitActionConditions } from './api-service';

const API_ENDPOINTS = {
  CHAT_STREAM: "/chat_stream",
  INDEXES: "/indexes/:id",
  GET_ALL_INDEXES: "/dids/:id/indexes",
  GET_PROFILE: "/dids/:id/profile",
  SEARCH_LINKS: "/search/links",
  GET_USER_INDEXES: "/search/user_indexes",
  LIT_ACTIONS: "/lit_actions",
  CRAWL: "/web2/webpage/crawl",
  ADD_INDEX_ITEM: "/items",
  CRAWL_CONTENT: "/links/crawl-content",
  FIND_CONTENT: "/links/find-content",
  SYNC_CONTENT: "/links/sync-content",
  NFT_METADATA: "/nft",
  ENS: "/ens",
  UPLOAD_AVATAR: "/upload_avatar",
  ZAPIER_TEST_LOGIN: "/zapier/test_login",
  SUBSCRIBE_TO_NEWSLETTER: "/subscribe",
};

class ApiService {
  private static instance: ApiService;
  private apiAxios: AxiosInstance;
  private session: DIDSession | null = null;
  private signerPublicKey: Indexes["signerPublicKey"] | null = null;

  private constructor() {
    this.apiAxios = axios.create({ baseURL: appConfig.apiUrl });
  }

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  public setSession(session: DIDSession) {
    this.session = session;
    console.log("ApiService.setSession", session);
    this.apiAxios.defaults.headers.Authorization = `Bearer ${session.serialize()}`;
  }

  setPkpPublicKey(signerPublicKey: Indexes["signerPublicKey"]) {
    this.signerPublicKey = signerPublicKey;
  }

  async getAllIndexes(id: string): Promise<Indexes[]> {
    const url = API_ENDPOINTS.GET_ALL_INDEXES.replace(":id", id);
    const { data } = await this.apiAxios.get<Indexes[]>(url);
    return data;
  }

  async getProfile(id: string): Promise<Users> {
    const url = API_ENDPOINTS.GET_PROFILE.replace(':id', id);
    const { data } = await this.apiAxios.get<Users>(url);
    return data;
  }

  async getIndex(indexId: string): Promise<Indexes | undefined> {
    const url = API_ENDPOINTS.INDEXES.replace(':id', indexId);
    const { data } = await this.apiAxios.get<Indexes>(url);
    return data as Indexes;
  }

  async getLITAction(cid: string): Promise<LitActionConditions | null> {
    try {
      const { data } = await this.apiAxios.get<LitActionConditions>(`${API_ENDPOINTS.LIT_ACTIONS}/${cid}`);
      return data;
    } catch (err) {
      return null;
    }
  }

  async postLITAction(conditions: LitActionConditions): Promise<string | null> {
    try {
      const { data } = await this.apiAxios.post<LitActionConditions>(`${API_ENDPOINTS.LIT_ACTIONS}`, conditions);
      return data as string;
    } catch (err) {
      return null;
    }
  }

  async crawlLink(url: string): Promise<Link> {
    const { data } = await this.apiAxios.post<Link>(API_ENDPOINTS.CRAWL, {
      title: DEFAULT_CREATE_INDEX_TITLE,
      url,
    });
    return data;
  }

  async addIndexItem(indexId: string, itemId: string) {
    const { data } = await this.apiAxios.post(API_ENDPOINTS.ADD_INDEX_ITEM, {
      indexId,
      itemId,
    });
    return data;
  }

  // async createIndex(title: string = DEFAULT_CREATE_INDEX_TITLE): Promise<Indexes> {
  //   const body = {
  //     title,
  //     signerPublicKey: this.signerPublicKey,
  //     signerFunction: this.signerFunction,
  //   };

  //   const { data } = await this.apiAxios.post<Indexes>('/indexes', body);
  //   return data;
  // }

  async createIndex(title: string = DEFAULT_CREATE_INDEX_TITLE): Promise<Indexes> {
    const body = {
      title,
      signerPublicKey: this.signerPublicKey,
      signerFunction: appConfig.defaultCID,
    };

    const { data } = await this.apiAxios.post<Indexes>('/indexes', body);
    return data;
  }
}

export default ApiService;
