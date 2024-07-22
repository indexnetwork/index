import IndexClient from "@/index";
import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { VectorStore } from "@langchain/core/vectorstores";
import { IDocument, IIndexConfig, ISearchParams } from "./types";

export default class IndexVectorStore extends VectorStore {
  public client: IndexClient;
  public sources: string[];

  constructor(embeddings: EmbeddingsInterface, args: IIndexConfig) {
    super(embeddings, args);

    this.embeddings = embeddings;
    this.sources = args.sources;
    this.client = args.client;
  }

  private async init() {
    if (!this.client) {
      throw new Error("IndexClient not provided");
    }
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
