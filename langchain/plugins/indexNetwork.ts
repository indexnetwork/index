import {
  DocumentCollection,
  IDocument,
  NotFoundError,
  ZepClient,
} from "@getzep/zep-js";

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
export interface IZepConfig {
  apiUrl: string;
  apiKey?: string;
  collectionName: string;
  description?: string;
  metadata?: Record<string, never>;
  embeddingDimensions?: number;
  isAutoEmbedded?: boolean;
}

export class IndexVectorStore extends VectorStore {
  public client: ZepClient;

  public collection: DocumentCollection;

  private initPromise: Promise<void>;

  private autoEmbed = false;

  constructor(embeddings: EmbeddingsInterface, args: IZepConfig) {
    super(embeddings, args);

    this.embeddings = embeddings;

    // eslint-disable-next-line no-instanceof/no-instanceof
    if (this.embeddings instanceof FakeEmbeddings) {
      this.autoEmbed = true;
    }

    this.initPromise = this.initCollection(args).catch((err) => {
      console.error("Error initializing collection:", err);
      throw err;
    });
  }

  static async init(zepConfig: IZepConfig) {
    const instance = new this(new FakeEmbeddings(), zepConfig);
    // Wait for collection to be initialized
    await instance.initPromise;
    return instance;
  }

  private async initCollection(args: IZepConfig) {}
  private async addDocument(doc: IDocument) {}
  // createCollection
  private async createCollection(args: IZepConfig) {}
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

  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: Record<string, unknown> | undefined,
  ): Promise<[Document, number][]> {
    return new Promise((resolve, reject) => {
      resolve([]);
    });
  }

  _vectorstoreType(): string {
    return "index";
  }
}
