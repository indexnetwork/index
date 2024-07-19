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
  private autoEmbed = false;

  constructor(embeddings: EmbeddingsInterface, args: IIndexConfig) {
    super(embeddings, args);

    this.embeddings = embeddings;
    this.sources = args.sources;

    // eslint-disable-next-line no-instanceof/no-instanceof
    if (this.embeddings instanceof FakeEmbeddings) {
      this.autoEmbed = true;
    }

    this.initPromise = this.initCollection(args).catch((err) => {
      console.error("Error initializing collection:", err);
      throw err;
    });
  }

  static async init(embeddings: EmbeddingsInterface, zepConfig: IIndexConfig) {
    const instance = new this(embeddings, zepConfig);
    // Wait for collection to be initialized
    await instance.initPromise;
    return instance;
  }

  private async initCollection(args: IIndexConfig) {
    this.client = args.client;
    await this.client.authenticate();
    // this.collection = await this.client.document.getCollection(
    //   args.collectionName,
    // );
  }

  private async addDocument(doc: IDocument) {}
  // createCollection
  private async createCollection(args: IIndexConfig) {}
  async addVectors(
    vectors: number[][],
    documents: Document[],
  ): Promise<string[]> {
    if (!this.autoEmbed && vectors.length === 0) {
      throw new Error(`Vectors must be provided if autoEmbed is false`);
    }
    if (!this.autoEmbed && vectors.length !== documents.length) {
      throw new Error(`Vectors and documents must have the same length`);
    }

    const docs: Array<IDocument> = [];
    for (let i = 0; i < documents.length; i += 1) {
      const doc: IDocument = {
        content: documents[i].pageContent,
        metadata: documents[i].metadata,
        embedding: vectors.length > 0 ? vectors[i] : undefined,
      };
      docs.push(doc);
    }
    // Wait for collection to be initialized
    await this.initPromise;
    return await this.collection.addDocuments(docs);
  }

  async addDocuments(documents: Document[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      resolve([]);
    });
  }

  async search(params: ISearchParams) {
    return this.client.search(params);
  }

  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: Record<string, unknown> | undefined,
  ): Promise<[Document, number][]> {
    console.log("similaritySearchVectorWithScore");
    console.log({ query, k, filter });
    console.log(this.sources);
    return this.client.search({
      sources: this.sources,
      // vector: query,
    });
  }

  _vectorstoreType(): string {
    return "index";
  }
}
