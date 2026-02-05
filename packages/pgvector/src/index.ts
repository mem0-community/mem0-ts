import {
  VectorStore,
  type SearchFilters,
  type VectorStoreConfig,
  type VectorStoreResult,
} from "@mem0-community/core";
import { Pool, type PoolConfig } from "pg";

export interface PGVectorConfig extends VectorStoreConfig {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
  tableName?: string;
  dimension?: number;
}

export class PGVectorStore extends VectorStore {
  private pool: Pool;
  private tableName: string;
  private dimension: number;

  constructor(config: PGVectorConfig) {
    super(config);

    if (config.pool) {
      this.pool = config.pool;
    } else if (config.connectionString) {
      this.pool = new Pool({ connectionString: config.connectionString });
    } else if (config.poolConfig) {
      this.pool = new Pool(config.poolConfig);
    } else {
      this.pool = new Pool();
    }

    this.tableName = config.tableName ?? config.collectionName ?? "memories";
    this.dimension = config.dimension ?? 1536;
    this._initialize().catch(console.error);
  }

  private async _initialize(): Promise<void> {
    await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        embedding vector(${this.dimension}),
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  private _buildWhereClause(
    filters?: SearchFilters,
    startParam = 1,
  ): { clause: string; values: unknown[] } {
    if (!filters || Object.keys(filters).length === 0) {
      return { clause: "", values: [] };
    }

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = startParam;

    for (const [key, value] of Object.entries(filters)) {
      conditions.push(`payload->>'${key}' = $${paramIdx}`);
      values.push(String(value));
      paramIdx++;
    }

    return { clause: `WHERE ${conditions.join(" AND ")}`, values };
  }

  async insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, any>[],
  ): Promise<void> {
    for (let i = 0; i < vectors.length; i++) {
      await this.pool.query(
        `INSERT INTO ${this.tableName} (id, embedding, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET embedding = $2, payload = $3`,
        [ids[i], `[${vectors[i]!.join(",")}]`, JSON.stringify(payloads[i])],
      );
    }
  }

  async search(
    query: number[],
    limit = 5,
    filters?: SearchFilters,
  ): Promise<VectorStoreResult[]> {
    const vectorStr = `[${query.join(",")}]`;
    const { clause, values } = this._buildWhereClause(filters, 2);

    const result = await this.pool.query(
      `SELECT id, payload, 1 - (embedding <=> $1) as score
       FROM ${this.tableName}
       ${clause}
       ORDER BY embedding <=> $1
       LIMIT ${limit}`,
      [vectorStr, ...values],
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      payload: row.payload,
      score: row.score,
    }));
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    const result = await this.pool.query(
      `SELECT id, payload FROM ${this.tableName} WHERE id = $1`,
      [vectorId],
    );
    if (result.rows.length === 0) return null;
    return { id: result.rows[0].id, payload: result.rows[0].payload };
  }

  async update(
    vectorId: string,
    vector: number[],
    payload: Record<string, any>,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.tableName} SET embedding = $1, payload = $2 WHERE id = $3`,
      [`[${vector.join(",")}]`, JSON.stringify(payload), vectorId],
    );
  }

  async delete(vectorId: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.tableName} WHERE id = $1`, [
      vectorId,
    ]);
  }

  async deleteCol(): Promise<void> {
    await this.pool.query(`DROP TABLE IF EXISTS ${this.tableName}`);
    await this._initialize();
  }

  async list(
    filters?: SearchFilters,
    limit = 100,
  ): Promise<[VectorStoreResult[], number]> {
    const { clause, values } = this._buildWhereClause(filters);

    const result = await this.pool.query(
      `SELECT id, payload FROM ${this.tableName} ${clause} LIMIT ${limit}`,
      values,
    );

    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM ${this.tableName} ${clause}`,
      values,
    );

    return [
      result.rows.map((row: any) => ({ id: row.id, payload: row.payload })),
      parseInt(countResult.rows[0].count, 10),
    ];
  }

  async getUserId(): Promise<string> {
    return crypto.randomUUID();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
