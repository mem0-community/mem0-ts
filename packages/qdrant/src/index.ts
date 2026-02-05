import {
  VectorStore,
  type SearchFilters,
  type VectorStoreConfig,
  type VectorStoreResult,
} from "@mem0-community/core";
import { QdrantClient } from "@qdrant/js-client-rest";

export interface QdrantConfig extends VectorStoreConfig {
  client?: QdrantClient;
  host?: string;
  port?: number;
  url?: string;
  apiKey?: string;
  collectionName: string;
  dimension?: number;
}

interface QdrantFilter {
  must?: QdrantCondition[];
}

interface QdrantCondition {
  key: string;
  match?: { value: unknown };
  range?: { gte?: number; gt?: number; lte?: number; lt?: number };
}

export class QdrantVectorStore extends VectorStore {
  private client: QdrantClient;
  private readonly collectionName: string;
  private dimension: number;

  constructor(config: QdrantConfig) {
    super(config);

    if (config.client) {
      this.client = config.client;
    } else {
      const params: Record<string, unknown> = {};
      if (config.apiKey) params.apiKey = config.apiKey;
      if (config.url) params.url = config.url;
      if (config.host && config.port) {
        params.host = config.host;
        params.port = config.port;
      }
      this.client = new QdrantClient(params);
    }

    this.collectionName = config.collectionName;
    this.dimension = config.dimension ?? 1536;
    this._initialize().catch(console.error);
  }

  private _createFilter(filters?: SearchFilters): QdrantFilter | undefined {
    if (!filters) return undefined;
    const conditions: QdrantCondition[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (
        typeof value === "object" &&
        value !== null &&
        "gte" in value &&
        "lte" in value
      ) {
        conditions.push({
          key,
          range: {
            gte: value.gte as number,
            lte: value.lte as number,
          },
        });
      } else {
        conditions.push({ key, match: { value } });
      }
    }
    return conditions.length ? { must: conditions } : undefined;
  }

  async insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, any>[],
  ): Promise<void> {
    await this.client.upsert(this.collectionName, {
      points: vectors.map((vector, idx) => ({
        id: ids[idx]!,
        vector,
        payload: payloads[idx] ?? {},
      })),
    });
  }

  async search(
    query: number[],
    limit = 5,
    filters?: SearchFilters,
  ): Promise<VectorStoreResult[]> {
    const results = await this.client.search(this.collectionName, {
      vector: query,
      filter: this._createFilter(filters),
      limit,
    });

    return results.map((hit) => ({
      id: String(hit.id),
      payload: (hit.payload as Record<string, any>) ?? {},
      score: hit.score,
    }));
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    const results = await this.client.retrieve(this.collectionName, {
      ids: [vectorId],
      with_payload: true,
    });
    if (!results.length) return null;
    return {
      id: vectorId,
      payload: (results[0]!.payload as Record<string, any>) ?? {},
    };
  }

  async update(
    vectorId: string,
    vector: number[],
    payload: Record<string, any>,
  ): Promise<void> {
    await this.client.upsert(this.collectionName, {
      points: [{ id: vectorId, vector, payload }],
    });
  }

  async delete(vectorId: string): Promise<void> {
    await this.client.delete(this.collectionName, { points: [vectorId] });
  }

  async deleteCol(): Promise<void> {
    await this.client.deleteCollection(this.collectionName);
  }

  async list(
    filters?: SearchFilters,
    limit = 100,
  ): Promise<[VectorStoreResult[], number]> {
    const response = await this.client.scroll(this.collectionName, {
      limit,
      filter: this._createFilter(filters),
      with_payload: true,
      with_vector: false,
    });

    const results = response.points.map((point) => ({
      id: String(point.id),
      payload: (point.payload as Record<string, any>) ?? {},
    }));

    return [results, response.points.length];
  }

  async getUserId(): Promise<string> {
    return crypto.randomUUID();
  }

  private async _initialize(): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === this.collectionName,
    );

    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: { size: this.dimension, distance: "Cosine" },
      });
    }
  }
}
