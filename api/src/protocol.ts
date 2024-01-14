/* eslint-disable */
/* tslint:disable */
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

export interface Index {
  title?: string;
  accessControl?: LITAccessControl;
  /** @format date-time */
  createdAt?: string;
  /** @format date-time */
  updatedAt?: string;
  /** @format date-time */
  deletedAt?: string;
  controllerDID?: string;
  version?: string;
}

export interface LITAccessControl {
  signerPublicKey?: string;
  signerFunction?: string;
}

export interface IndexItem {
  indexId?: string;
  itemId?: string;
  /** @format date-time */
  createdAt?: string;
  /** @format date-time */
  updatedAt?: string;
  /** @format date-time */
  deletedAt?: string;
  version?: string;
}

export interface Embedding {
  modelName?: string;
  vector?: number[];
  context?: EmbeddingContext;
  indexId?: string;
  itemId?: string;
  /** @format date-time */
  createdAt?: string;
  /** @format date-time */
  updatedAt?: string;
  /** @format date-time */
  deletedAt?: string;
  controllerDID?: string;
  version?: string;
}

export interface EmbeddingContext {
  context?: string;
  contextDescription?: string;
  category?: string;
}

export type QueryParamsType = Record<string | number, any>;
export type ResponseFormat = keyof Omit<Body, "body" | "bodyUsed">;

export interface FullRequestParams extends Omit<RequestInit, "body"> {
  /** set parameter to `true` for call `securityWorker` for this request */
  secure?: boolean;
  /** request path */
  path: string;
  /** content type of request body */
  type?: ContentType;
  /** query params */
  query?: QueryParamsType;
  /** format of response (i.e. response.json() -> format: "json") */
  format?: ResponseFormat;
  /** request body */
  body?: unknown;
  /** base url */
  baseUrl?: string;
  /** request cancellation token */
  cancelToken?: CancelToken;
}

export type RequestParams = Omit<FullRequestParams, "body" | "method" | "query" | "path">;

export interface ApiConfig<SecurityDataType = unknown> {
  baseUrl?: string;
  baseApiParams?: Omit<RequestParams, "baseUrl" | "cancelToken" | "signal">;
  securityWorker?: (securityData: SecurityDataType | null) => Promise<RequestParams | void> | RequestParams | void;
  customFetch?: typeof fetch;
}

export interface HttpResponse<D extends unknown, E extends unknown = unknown> extends Response {
  data: D;
  error: E;
}

type CancelToken = Symbol | string | number;

export enum ContentType {
  Json = "application/json",
  FormData = "multipart/form-data",
  UrlEncoded = "application/x-www-form-urlencoded",
  Text = "text/plain",
}

export class HttpClient<SecurityDataType = unknown> {
  public baseUrl: string = "";
  private securityData: SecurityDataType | null = null;
  private securityWorker?: ApiConfig<SecurityDataType>["securityWorker"];
  private abortControllers = new Map<CancelToken, AbortController>();
  private customFetch = (...fetchParams: Parameters<typeof fetch>) => fetch(...fetchParams);

  private baseApiParams: RequestParams = {
    credentials: "same-origin",
    headers: {},
    redirect: "follow",
    referrerPolicy: "no-referrer",
  };

  constructor(apiConfig: ApiConfig<SecurityDataType> = {}) {
    Object.assign(this, apiConfig);
  }

  public setSecurityData = (data: SecurityDataType | null) => {
    this.securityData = data;
  };

  protected encodeQueryParam(key: string, value: any) {
    const encodedKey = encodeURIComponent(key);
    return `${encodedKey}=${encodeURIComponent(typeof value === "number" ? value : `${value}`)}`;
  }

  protected addQueryParam(query: QueryParamsType, key: string) {
    return this.encodeQueryParam(key, query[key]);
  }

  protected addArrayQueryParam(query: QueryParamsType, key: string) {
    const value = query[key];
    return value.map((v: any) => this.encodeQueryParam(key, v)).join("&");
  }

  protected toQueryString(rawQuery?: QueryParamsType): string {
    const query = rawQuery || {};
    const keys = Object.keys(query).filter((key) => "undefined" !== typeof query[key]);
    return keys
      .map((key) => (Array.isArray(query[key]) ? this.addArrayQueryParam(query, key) : this.addQueryParam(query, key)))
      .join("&");
  }

  protected addQueryParams(rawQuery?: QueryParamsType): string {
    const queryString = this.toQueryString(rawQuery);
    return queryString ? `?${queryString}` : "";
  }

  private contentFormatters: Record<ContentType, (input: any) => any> = {
    [ContentType.Json]: (input: any) =>
      input !== null && (typeof input === "object" || typeof input === "string") ? JSON.stringify(input) : input,
    [ContentType.Text]: (input: any) => (input !== null && typeof input !== "string" ? JSON.stringify(input) : input),
    [ContentType.FormData]: (input: any) =>
      Object.keys(input || {}).reduce((formData, key) => {
        const property = input[key];
        formData.append(
          key,
          property instanceof Blob
            ? property
            : typeof property === "object" && property !== null
            ? JSON.stringify(property)
            : `${property}`,
        );
        return formData;
      }, new FormData()),
    [ContentType.UrlEncoded]: (input: any) => this.toQueryString(input),
  };

  protected mergeRequestParams(params1: RequestParams, params2?: RequestParams): RequestParams {
    return {
      ...this.baseApiParams,
      ...params1,
      ...(params2 || {}),
      headers: {
        ...(this.baseApiParams.headers || {}),
        ...(params1.headers || {}),
        ...((params2 && params2.headers) || {}),
      },
    };
  }

  protected createAbortSignal = (cancelToken: CancelToken): AbortSignal | undefined => {
    if (this.abortControllers.has(cancelToken)) {
      const abortController = this.abortControllers.get(cancelToken);
      if (abortController) {
        return abortController.signal;
      }
      return void 0;
    }

    const abortController = new AbortController();
    this.abortControllers.set(cancelToken, abortController);
    return abortController.signal;
  };

  public abortRequest = (cancelToken: CancelToken) => {
    const abortController = this.abortControllers.get(cancelToken);

    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(cancelToken);
    }
  };

  public request = async <T = any, E = any>({
    body,
    secure,
    path,
    type,
    query,
    format,
    baseUrl,
    cancelToken,
    ...params
  }: FullRequestParams): Promise<HttpResponse<T, E>> => {
    const secureParams =
      ((typeof secure === "boolean" ? secure : this.baseApiParams.secure) &&
        this.securityWorker &&
        (await this.securityWorker(this.securityData))) ||
      {};
    const requestParams = this.mergeRequestParams(params, secureParams);
    const queryString = query && this.toQueryString(query);
    const payloadFormatter = this.contentFormatters[type || ContentType.Json];
    const responseFormat = format || requestParams.format;

    return this.customFetch(`${baseUrl || this.baseUrl || ""}${path}${queryString ? `?${queryString}` : ""}`, {
      ...requestParams,
      headers: {
        ...(requestParams.headers || {}),
        ...(type && type !== ContentType.FormData ? { "Content-Type": type } : {}),
      },
      signal: (cancelToken ? this.createAbortSignal(cancelToken) : requestParams.signal) || null,
      body: typeof body === "undefined" || body === null ? null : payloadFormatter(body),
    }).then(async (response) => {
      const r = response as HttpResponse<T, E>;
      r.data = null as unknown as T;
      r.error = null as unknown as E;

      const data = !responseFormat
        ? r
        : await response[responseFormat]()
            .then((data) => {
              if (r.ok) {
                r.data = data;
              } else {
                r.error = data;
              }
              return r;
            })
            .catch((e) => {
              r.error = e;
              return r;
            });

      if (cancelToken) {
        this.abortControllers.delete(cancelToken);
      }

      if (!response.ok) throw data;
      return data;
    });
  };
}

/**
 * @title Index and Embedding API
 * @version 1.0.0
 */
export class Api<SecurityDataType extends unknown> extends HttpClient<SecurityDataType> {
  index = {
    /**
     * @description Endpoint to create a new Index entity.
     *
     * @name IndexCreate
     * @summary Create a new Index
     * @request POST:/index
     * @secure
     */
    indexCreate: (data: Index, params: RequestParams = {}) =>
      this.request<void, void>({
        path: `/index`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description Retrieves a list of all Index entities.
     *
     * @name IndexList
     * @summary List all Indexes
     * @request GET:/index
     */
    indexList: (params: RequestParams = {}) =>
      this.request<Index[], void>({
        path: `/index`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * @description Retrieve an Index entity by its unique identifier.
     *
     * @name IndexDetail
     * @summary Get an Index by ID
     * @request GET:/index/{indexId}
     */
    indexDetail: (indexId: string, params: RequestParams = {}) =>
      this.request<Index, void>({
        path: `/index/${indexId}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * @description Update an existing Index entity by its ID.
     *
     * @name IndexUpdate
     * @summary Update an Index by ID
     * @request PUT:/index/{indexId}
     * @secure
     */
    indexUpdate: (indexId: string, data: Index, params: RequestParams = {}) =>
      this.request<void, void>({
        path: `/index/${indexId}`,
        method: "PUT",
        body: data,
        secure: true,
        type: ContentType.Json,
        ...params,
      }),
  };
  item = {
    /**
     * @description Endpoint to create a new IndexItem entity.
     *
     * @name ItemCreate
     * @summary Create a new IndexItem
     * @request POST:/item
     * @secure
     */
    itemCreate: (data: IndexItem, params: RequestParams = {}) =>
      this.request<void, void>({
        path: `/item`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description Retrieves a list of all IndexItem entities.
     *
     * @name ItemList
     * @summary List all IndexItems
     * @request GET:/item
     */
    itemList: (params: RequestParams = {}) =>
      this.request<IndexItem[], void>({
        path: `/item`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * @description Retrieve an IndexItem entity by its unique identifier.
     *
     * @name ItemDetail
     * @summary Get an IndexItem by ID
     * @request GET:/item/{itemId}
     */
    itemDetail: (itemId: string, params: RequestParams = {}) =>
      this.request<IndexItem, void>({
        path: `/item/${itemId}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * @description Update an existing IndexItem entity by its ID.
     *
     * @name ItemUpdate
     * @summary Update an IndexItem by ID
     * @request PUT:/item/{itemId}
     * @secure
     */
    itemUpdate: (itemId: string, data: IndexItem, params: RequestParams = {}) =>
      this.request<void, void>({
        path: `/item/${itemId}`,
        method: "PUT",
        body: data,
        secure: true,
        type: ContentType.Json,
        ...params,
      }),
  };
  embedding = {
    /**
     * @description Endpoint to create a new Embedding entity.
     *
     * @name EmbeddingCreate
     * @summary Create a new Embedding
     * @request POST:/embedding
     * @secure
     */
    embeddingCreate: (data: Embedding, params: RequestParams = {}) =>
      this.request<void, void>({
        path: `/embedding`,
        method: "POST",
        body: data,
        secure: true,
        type: ContentType.Json,
        ...params,
      }),

    /**
     * @description Retrieves a list of all Embedding entities.
     *
     * @name EmbeddingList
     * @summary List all Embeddings
     * @request GET:/embedding
     */
    embeddingList: (params: RequestParams = {}) =>
      this.request<Embedding[], void>({
        path: `/embedding`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * @description Retrieve an Embedding entity by its unique identifier.
     *
     * @name EmbeddingDetail
     * @summary Get an Embedding by ID
     * @request GET:/embedding/{embeddingId}
     */
    embeddingDetail: (embeddingId: string, params: RequestParams = {}) =>
      this.request<Embedding, void>({
        path: `/embedding/${embeddingId}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * @description Update an existing Embedding entity by its ID.
     *
     * @name EmbeddingUpdate
     * @summary Update an Embedding by ID
     * @request PUT:/embedding/{embeddingId}
     * @secure
     */
    embeddingUpdate: (embeddingId: string, data: Embedding, params: RequestParams = {}) =>
      this.request<void, void>({
        path: `/embedding/${embeddingId}`,
        method: "PUT",
        body: data,
        secure: true,
        type: ContentType.Json,
        ...params,
      }),
  };
  query = {
    /**
     * @description This endpoint allows for a complex query against indexes, items, and embeddings, filtered by specific identifiers and categories. It supports querying based on Decentralized Identifiers (DIDs), item and index identifiers, and specific types of embeddings.
     *
     * @name QueryCreate
     * @summary Query
     * @request POST:/query
     */
    queryCreate: (
      data: {
        /** Array of indexes to be queried. */
        indexes?: string[];
        /** Array of DIDs for filtering or access control. */
        dids?: string[];
        /** Array of items within the indexes to be queried. */
        items?: string[];
        /** Embeddings categories to be used in the query. */
        embeddingCategories?: string[];
        /** Embeddings vector to be utilized for similarty search in the query. */
        vectors?: number[];
        /** Decentralized Identifier of the viewer or user making the query. */
        viewerDID?: string;
        /** The query string or question to be answered. */
        question?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<object, void>({
        path: `/query`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),
  };
}
