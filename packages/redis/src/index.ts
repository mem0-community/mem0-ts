import {
  VectorStore,
  type SearchFilters,
  type VectorStoreConfig,
  type VectorStoreResult,
} from "@mem0-community/core";
import { createClient, type RedisClientType } from "redis";

export interface RedisVectorStoreConfig extends VectorStoreConfig {
  redisUrl: string;
  collectionName: string;
  embeddingModelDims: number;
  username?: string;
  password?: string;
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function payloadToSnakeCase(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toSnakeCase(key)] = value;
  }
  return result;
}

function payloadToCamelCase(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toCamelCase(key)] = value;
  }
  return result;
}

function float32ArrayToBuffer(arr: number[]): Buffer {
  const float32 = new Float32Array(arr);
  return Buffer.from(float32.buffer);
}

export class RedisVectorStore extends VectorStore {
  private client: RedisClientType;
  private readonly collectionName: string;
  private readonly embeddingModelDims: number;
  private readonly indexName: string;
  private readonly prefix: string;
  private initialized = false;

  constructor(config: RedisVectorStoreConfig) {
    super(config);
    this.collectionName = config.collectionName;
    this.embeddingModelDims = config.embeddingModelDims;
    this.indexName = this.collectionName;
    this.prefix = `mem0:${this.collectionName}:`;

    this.client = createClient({
      url: config.redisUrl,
      username: config.username,
      password: config.password,
    }) as RedisClientType;

    this._initialize().catch(console.error);
  }

  private async _ensureConnected(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  private async _initialize(): Promise<void> {
    if (this.initialized) return;
    await this._ensureConnected();

    try {
      await this.client.ft.info(this.indexName);
    } catch {
      await this.client.ft.create(
        this.indexName,
        {
          memory_id: { type: "TAG", SORTABLE: true },
          hash: { type: "TAG", SORTABLE: true },
          agent_id: { type: "TAG", SORTABLE: true },
          run_id: { type: "TAG", SORTABLE: true },
          user_id: { type: "TAG", SORTABLE: true },
          memory: { type: "TEXT", SORTABLE: true },
          metadata: { type: "TEXT", SORTABLE: true },
          created_at: { type: "NUMERIC", SORTABLE: true },
          updated_at: { type: "NUMERIC", SORTABLE: true },
          embedding: {
            type: "VECTOR",
            ALGORITHM: "FLAT",
            TYPE: "FLOAT32",
            DIM: this.embeddingModelDims,
            DISTANCE_METRIC: "COSINE",
          },
        } as any,
        {
          ON: "HASH",
          PREFIX: this.prefix,
        },
      );
    }

    this.initialized = true;
  }

  private _buildTagFilter(filters?: SearchFilters): string {
    if (!filters) return "*";
    const parts: string[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;
      const snakeKey = toSnakeCase(key);
      parts.push(
        `@${snakeKey}:{${String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&")}}`,
      );
    }
    return parts.length > 0 ? parts.join(" ") : "*";
  }

  async insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, any>[],
  ): Promise<void> {
    await this._ensureConnected();
    await this._initialize();

    for (let i = 0; i < vectors.length; i++) {
      const id = ids[i]!;
      const vector = vectors[i]!;
      const payload = payloads[i] ?? {};
      const snakePayload = payloadToSnakeCase(payload);
      const key = `${this.prefix}${id}`;

      const now = Date.now();
      const record: Record<string, string | Buffer | number> = {
        memory_id: id,
        hash: String(snakePayload.hash ?? ""),
        agent_id: String(snakePayload.agent_id ?? ""),
        run_id: String(snakePayload.run_id ?? ""),
        user_id: String(snakePayload.user_id ?? ""),
        memory: String(snakePayload.memory ?? snakePayload.data ?? ""),
        metadata: JSON.stringify(snakePayload),
        created_at: Number(snakePayload.created_at ?? now),
        updated_at: Number(snakePayload.updated_at ?? now),
        embedding: float32ArrayToBuffer(vector),
      };

      await this.client.hSet(key, record as any);
    }
  }

  async search(
    query: number[],
    limit = 5,
    filters?: SearchFilters,
  ): Promise<VectorStoreResult[]> {
    await this._ensureConnected();
    await this._initialize();

    const tagFilter = this._buildTagFilter(filters);
    const queryStr = `(${tagFilter})=>[KNN ${limit} @embedding $BLOB AS score]`;
    const blob = float32ArrayToBuffer(query);

    const results = await this.client.ft.search(this.indexName, queryStr, {
      PARAMS: { BLOB: blob },
      SORTBY: { BY: "score", DIRECTION: "ASC" },
      LIMIT: { from: 0, size: limit },
      DIALECT: 2,
      RETURN: [
        "memory_id",
        "hash",
        "agent_id",
        "run_id",
        "user_id",
        "memory",
        "metadata",
        "created_at",
        "updated_at",
        "score",
      ],
    } as any);

    return results.documents.map((doc: any) => {
      const value = doc.value as Record<string, string>;
      let payload: Record<string, any>;
      try {
        payload = payloadToCamelCase(JSON.parse(value.metadata ?? "{}"));
      } catch {
        payload = payloadToCamelCase(value as Record<string, unknown>);
      }

      return {
        id: String(value.memory_id ?? doc.id?.replace(this.prefix, "") ?? ""),
        payload,
        score: value.score ? 1 - parseFloat(value.score) : undefined,
      };
    });
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    await this._ensureConnected();
    await this._initialize();

    const key = `${this.prefix}${vectorId}`;
    const data = await this.client.hGetAll(key);
    if (!data || Object.keys(data).length === 0) return null;

    let payload: Record<string, any>;
    try {
      payload = payloadToCamelCase(
        JSON.parse((data as Record<string, string>).metadata ?? "{}"),
      );
    } catch {
      payload = payloadToCamelCase(data as Record<string, unknown>);
    }

    return { id: vectorId, payload };
  }

  async update(
    vectorId: string,
    vector: number[],
    payload: Record<string, any>,
  ): Promise<void> {
    await this._ensureConnected();
    await this._initialize();

    const key = `${this.prefix}${vectorId}`;
    const snakePayload = payloadToSnakeCase(payload);
    const now = Date.now();

    const record: Record<string, string | Buffer | number> = {
      memory_id: vectorId,
      hash: String(snakePayload.hash ?? ""),
      agent_id: String(snakePayload.agent_id ?? ""),
      run_id: String(snakePayload.run_id ?? ""),
      user_id: String(snakePayload.user_id ?? ""),
      memory: String(snakePayload.memory ?? snakePayload.data ?? ""),
      metadata: JSON.stringify(snakePayload),
      created_at: Number(snakePayload.created_at ?? now),
      updated_at: now,
      embedding: float32ArrayToBuffer(vector),
    };

    await this.client.hSet(key, record as any);
  }

  async delete(vectorId: string): Promise<void> {
    await this._ensureConnected();
    const key = `${this.prefix}${vectorId}`;
    await this.client.del(key);
  }

  async deleteCol(): Promise<void> {
    await this._ensureConnected();
    try {
      await this.client.ft.dropIndex(this.indexName, { DD: true });
    } catch {
      // Index may not exist
    }
    this.initialized = false;
  }

  async list(
    filters?: SearchFilters,
    limit = 100,
  ): Promise<[VectorStoreResult[], number]> {
    await this._ensureConnected();
    await this._initialize();

    const tagFilter = this._buildTagFilter(filters);
    const results = await this.client.ft.search(this.indexName, tagFilter, {
      LIMIT: { from: 0, size: limit },
      RETURN: [
        "memory_id",
        "hash",
        "agent_id",
        "run_id",
        "user_id",
        "memory",
        "metadata",
        "created_at",
        "updated_at",
      ],
      DIALECT: 2,
    } as any);

    const items = results.documents.map((doc: any) => {
      const value = doc.value as Record<string, string>;
      let payload: Record<string, any>;
      try {
        payload = payloadToCamelCase(JSON.parse(value.metadata ?? "{}"));
      } catch {
        payload = payloadToCamelCase(value as Record<string, unknown>);
      }
      return {
        id: String(value.memory_id ?? doc.id?.replace(this.prefix, "") ?? ""),
        payload,
      };
    });

    return [items, results.total];
  }

  async getUserId(): Promise<string> {
    await this._ensureConnected();
    const migrationKey = "memory_migrations:1";
    const existing = await this.client.get(migrationKey);
    if (existing) return existing;
    const newId = crypto.randomUUID();
    await this.client.set(migrationKey, newId);
    return newId;
  }
}
