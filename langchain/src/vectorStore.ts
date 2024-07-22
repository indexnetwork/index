import {
  DocumentCollection,
  IDocument,
  NotFoundError,
  ZepClient,
} from "@getzep/zep-js";

import IndexClient from "@indexnetwork/sdk";

import {
  MaxMarginalRelevanceSearchOptions,
  VectorStore,
} from "@langchain/core/vectorstores";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { Document } from "@langchain/core/documents";
import { Callbacks } from "@langchain/core/callbacks/manager";
import { maximalMarginalRelevance } from "@langchain/core/utils/math";
import { FakeEmbeddings } from "@langchain/core/utils/testing";

export interface IZepArgs {
  collection: DocumentCollection;
}

/**
 * Interface for the configuration options for a ZepVectorStore instance.
 */
export interface IIndexConfig {
  client: IndexClient;
  sources: string[];
}

interface ISearchParams {
  sources: string[];
  vector?: number[];
  page?: number;
  categories?: string[];
  modelNames?: string[];
}

export class IndexVectorStore extends VectorStore {
  public client: IndexClient;
  public sources: string[];
  private initPromise: Promise<void>;

  constructor(embeddings: EmbeddingsInterface, args: IIndexConfig) {
    super(embeddings, args);

    this.embeddings = embeddings;
    this.sources = args.sources;

    this.initPromise = this.initCollection(args).catch((err) => {
      console.error("Error initializing collection:", err);
      throw err;
    });
  }

  static async init(embeddings: EmbeddingsInterface, zepConfig: IIndexConfig) {
    const instance = new this(embeddings, zepConfig);
    await instance.initPromise;
    return instance;
  }

  private async initCollection(args: IIndexConfig) {
    this.client = args.client;
    await this.client.authenticate();
  }

  toDocumentsAndScore(results: any[]): [Document, number][] {
    return results.map((d) => [
      new Document({
        id: d.id,
        pageContent: JSON.stringify(d),
      }),
      d.score ? d.score : 0,
    ]);
  }

  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: Record<string, unknown> | undefined,
  ): Promise<[Document, number][]> {
    const result = await this.client.search({
      sources: this.sources,
      vector: query,
    });

    return this.toDocumentsAndScore(result);
  }

  private async addDocument(doc: IDocument) {}

  private async createCollection(args: IIndexConfig) {}

  async addVectors(
    vectors: number[][],
    documents: Document[],
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      resolve([]);
    });
  }

  async addDocuments(documents: Document[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      resolve([]);
    });
  }

  async search(params: ISearchParams) {
    return this.client.search(params);
  }

  _vectorstoreType(): string {
    return "index";
  }
}
