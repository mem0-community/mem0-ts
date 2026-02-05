export interface SearchFilters {
  userId?: string;
  agentId?: string;
  runId?: string;
  [key: string]: unknown;
}

export interface VectorStoreResult {
  id: string;
  payload: Record<string, any>;
  score?: number;
}

export interface VectorStoreConfig {
  collectionName?: string;
  dimension?: number;
  [key: string]: unknown;
}

export abstract class VectorStore {
  protected config: VectorStoreConfig;

  constructor(config: VectorStoreConfig) {
    this.config = config;
  }

  abstract insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, any>[],
  ): Promise<void>;

  abstract search(
    query: number[],
    limit: number,
    filters?: SearchFilters,
  ): Promise<VectorStoreResult[]>;

  abstract get(vectorId: string): Promise<VectorStoreResult | null>;

  abstract update(
    vectorId: string,
    vector: number[],
    payload: Record<string, any>,
  ): Promise<void>;

  abstract delete(vectorId: string): Promise<void>;

  abstract deleteCol(): Promise<void>;

  abstract list(
    filters?: SearchFilters,
    limit?: number,
  ): Promise<[VectorStoreResult[], number]>;

  abstract getUserId(): Promise<string>;
}
