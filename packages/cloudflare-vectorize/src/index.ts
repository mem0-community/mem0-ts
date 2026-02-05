import {
  VectorStore,
  type SearchFilters,
  type VectorStoreConfig,
  type VectorStoreResult,
} from "@mem0-community/core";
import Cloudflare from "cloudflare";
import type { VectorizeVector } from "@cloudflare/workers-types";

export interface CloudflareVectorizeConfig extends VectorStoreConfig {
  apiKey?: string;
  indexName: string;
  accountId: string;
  dimension?: number;
}

export class CloudflareVectorizeStore extends VectorStore {
  private client: Cloudflare;
  private readonly indexName: string;
  private readonly accountId: string;
  private readonly dim: number;
  private initialized = false;

  constructor(config: CloudflareVectorizeConfig) {
    super(config);
    this.indexName = config.indexName;
    this.accountId = config.accountId;
    this.dim = config.dimension ?? 1536;

    this.client = new Cloudflare({
      apiToken: config.apiKey,
    });

    this._initialize().catch(console.error);
  }

  async insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, any>[],
  ): Promise<void> {
    await this._initialize();

    // Vectorize v2 insert uses ndjson via the REST API
    const ndjsonLines = vectors.map((vector, idx) => {
      const payload = payloads[idx] ?? {};
      const record: VectorizeVector = {
        id: ids[idx]!,
        values: vector,
        metadata: {
          userId: String(payload.userId ?? payload.user_id ?? ""),
          agentId: String(payload.agentId ?? payload.agent_id ?? ""),
          runId: String(payload.runId ?? payload.run_id ?? ""),
          hash: String(payload.hash ?? ""),
          data: String(payload.data ?? payload.memory ?? ""),
          createdAt: Number(
            payload.createdAt ?? payload.created_at ?? Date.now(),
          ),
          updatedAt: Number(
            payload.updatedAt ?? payload.updated_at ?? Date.now(),
          ),
          payload: JSON.stringify(payload),
        },
      };
      return JSON.stringify(record);
    });
    const ndjsonBody = ndjsonLines.join("\n");

    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/${this.indexName}/upsert`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.client.apiToken}`,
        "Content-Type": "application/x-ndjson",
      },
      body: ndjsonBody,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cloudflare Vectorize insert failed: ${text}`);
    }
  }

  async search(
    query: number[],
    limit = 5,
    filters?: SearchFilters,
  ): Promise<VectorStoreResult[]> {
    await this._initialize();

    const filterObj = this._buildFilter(filters);

    const result = await this.client.vectorize.indexes.query(this.indexName, {
      account_id: this.accountId,
      vector: query,
      topK: limit,
      returnValues: false,
      returnMetadata: "all",
      filter: filterObj,
    });

    const matches = (result as any).matches ?? [];
    return matches.map(
      (match: {
        id: string;
        score: number;
        metadata?: Record<string, any>;
      }) => {
        let payload: Record<string, any> = {};
        if (match.metadata?.payload) {
          try {
            payload = JSON.parse(String(match.metadata.payload));
          } catch {
            payload = match.metadata ?? {};
          }
        } else {
          payload = match.metadata ?? {};
        }
        return {
          id: match.id,
          payload,
          score: match.score,
        };
      },
    );
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    await this._initialize();

    try {
      const result = await this.client.vectorize.indexes.getByIds(
        this.indexName,
        {
          account_id: this.accountId,
          ids: [vectorId],
        },
      );

      const vectors = (result as any) ?? [];
      if (!Array.isArray(vectors) || vectors.length === 0) return null;

      const vec = vectors[0];
      let payload: Record<string, any> = {};
      if (vec.metadata?.payload) {
        try {
          payload = JSON.parse(String(vec.metadata.payload));
        } catch {
          payload = vec.metadata ?? {};
        }
      } else {
        payload = vec.metadata ?? {};
      }

      return { id: vec.id, payload };
    } catch {
      return null;
    }
  }

  async update(
    vectorId: string,
    vector: number[],
    payload: Record<string, any>,
  ): Promise<void> {
    // Vectorize uses upsert for updates
    await this.insert([vector], [vectorId], [payload]);
  }

  async delete(vectorId: string): Promise<void> {
    await this._initialize();

    await this.client.vectorize.indexes.deleteByIds(this.indexName, {
      account_id: this.accountId,
      ids: [vectorId],
    });
  }

  async deleteCol(): Promise<void> {
    try {
      await this.client.vectorize.indexes.delete(this.indexName, {
        account_id: this.accountId,
      });
    } catch {
      // Index may not exist
    }
    this.initialized = false;
  }

  async list(
    filters?: SearchFilters,
    limit = 100,
  ): Promise<[VectorStoreResult[], number]> {
    await this._initialize();

    // Cloudflare Vectorize does not have a native list/scroll API.
    // We use a zero-vector query to retrieve documents with optional filters.
    const zeroVector = new Array(this.dim).fill(0);
    const results = await this.search(zeroVector, limit, filters);
    return [results, results.length];
  }

  async getUserId(): Promise<string> {
    return crypto.randomUUID();
  }

  private _buildFilter(
    filters?: SearchFilters,
  ): Record<string, any> | undefined {
    if (!filters) return undefined;
    const filterObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;
      filterObj[key] = value;
    }
    return Object.keys(filterObj).length > 0 ? filterObj : undefined;
  }

  private async _initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.client.vectorize.indexes.get(this.indexName, {
        account_id: this.accountId,
      });
    } catch {
      await this.client.vectorize.indexes.create({
        account_id: this.accountId,
        config: {
          dimensions: this.dim,
          metric: "cosine",
        },
        name: this.indexName,
      });

      // Create metadata indexes for filterable fields
      const metadataFields = ["userId", "agentId", "runId"];
      for (const field of metadataFields) {
        try {
          await this.client.vectorize.indexes.metadataIndex.create(
            this.indexName,
            {
              account_id: this.accountId,
              propertyName: field,
              indexType: "string",
            },
          );
        } catch {
          // Metadata index may already exist
        }
      }
    }

    this.initialized = true;
  }
}
