import IndexClient from "@indexnetwork/sdk";

export interface IDocument {
  uuid?: string;
  created_at?: Date;
  updated_at?: Date;
  document_id?: string;
  content: string;
  metadata?: Record<string, any>;
  is_embedded?: boolean;
  embedding?: Float32Array | number[];
  score?: number;
}

export interface IIndexConfig {
  client: IndexClient;
  sources: string[];
}

export interface ISearchParams {
  sources: string[];
  vector?: number[];
  page?: number;
  categories?: string[];
  modelNames?: string[];
}
