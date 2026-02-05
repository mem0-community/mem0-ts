import {
  VectorStore,
  type SearchFilters,
  type VectorStoreConfig,
  type VectorStoreResult,
  type HistoryManager,
  type HistoryEntry,
} from "@mem0-community/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------------------- */
/*  SupabaseVectorStore                                                       */
/* -------------------------------------------------------------------------- */

export interface SupabaseVectorStoreConfig extends VectorStoreConfig {
  supabaseUrl: string;
  supabaseKey: string;
  tableName: string;
  embeddingColumnName?: string;
  metadataColumnName?: string;
}

export class SupabaseVectorStore extends VectorStore {
  private client: SupabaseClient;
  private readonly tableName: string;
  private readonly embeddingColumn: string;
  private readonly metadataColumn: string;

  constructor(config: SupabaseVectorStoreConfig) {
    super(config);
    this.client = createClient(config.supabaseUrl, config.supabaseKey);
    this.tableName = config.tableName;
    this.embeddingColumn = config.embeddingColumnName ?? "embedding";
    this.metadataColumn = config.metadataColumnName ?? "metadata";
  }

  async insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, any>[],
  ): Promise<void> {
    const rows = vectors.map((vector, idx) => ({
      id: ids[idx]!,
      [this.embeddingColumn]: vector,
      [this.metadataColumn]: payloads[idx] ?? {},
    }));

    const { error } = await this.client.from(this.tableName).upsert(rows);
    if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  }

  async search(
    query: number[],
    limit = 5,
    filters?: SearchFilters,
  ): Promise<VectorStoreResult[]> {
    const params: Record<string, unknown> = {
      query_embedding: query,
      match_count: limit,
      filter: filters ?? {},
    };

    const { data, error } = await this.client.rpc("match_vectors", params);
    if (error) throw new Error(`Supabase search failed: ${error.message}`);

    return (data ?? []).map(
      (row: {
        id: string;
        metadata: Record<string, any>;
        similarity: number;
      }) => ({
        id: String(row.id),
        payload: row.metadata ?? {},
        score: row.similarity,
      }),
    );
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select("*")
      .eq("id", vectorId)
      .single();

    if (error || !data) return null;

    return {
      id: String(data.id),
      payload: (data as Record<string, any>)[this.metadataColumn] ?? {},
    };
  }

  async update(
    vectorId: string,
    vector: number[],
    payload: Record<string, any>,
  ): Promise<void> {
    const { error } = await this.client
      .from(this.tableName)
      .update({
        [this.embeddingColumn]: vector,
        [this.metadataColumn]: payload,
      })
      .eq("id", vectorId);

    if (error) throw new Error(`Supabase update failed: ${error.message}`);
  }

  async delete(vectorId: string): Promise<void> {
    const { error } = await this.client
      .from(this.tableName)
      .delete()
      .eq("id", vectorId);

    if (error) throw new Error(`Supabase delete failed: ${error.message}`);
  }

  async deleteCol(): Promise<void> {
    const { error } = await this.client
      .from(this.tableName)
      .delete()
      .neq("id", "");

    if (error) throw new Error(`Supabase deleteCol failed: ${error.message}`);
  }

  async list(
    filters?: SearchFilters,
    limit = 100,
  ): Promise<[VectorStoreResult[], number]> {
    let query = this.client
      .from(this.tableName)
      .select("*", { count: "exact" });

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value === undefined || value === null) continue;
        query = query.eq(`${this.metadataColumn}->>${key}`, String(value));
      }
    }

    const { data, error, count } = await query.limit(limit);
    if (error) throw new Error(`Supabase list failed: ${error.message}`);

    const results = (data ?? []).map((row: Record<string, any>) => ({
      id: String(row.id),
      payload: row[this.metadataColumn] ?? {},
    }));

    return [results, count ?? results.length];
  }

  async getUserId(): Promise<string> {
    return crypto.randomUUID();
  }
}

/* -------------------------------------------------------------------------- */
/*  SupabaseHistoryManager                                                    */
/* -------------------------------------------------------------------------- */

export interface SupabaseHistoryManagerConfig {
  supabaseUrl: string;
  supabaseKey: string;
  tableName?: string;
}

export class SupabaseHistoryManager implements HistoryManager {
  private client: SupabaseClient;
  private readonly tableName: string;

  constructor(config: SupabaseHistoryManagerConfig) {
    this.client = createClient(config.supabaseUrl, config.supabaseKey);
    this.tableName = config.tableName ?? "memory_history";
  }

  async addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: string,
    createdAt?: string,
    updatedAt?: string,
    isDeleted = 0,
  ): Promise<void> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error } = await this.client.from(this.tableName).insert({
      id,
      memory_id: memoryId,
      previous_value: previousValue,
      new_value: newValue,
      action,
      created_at: createdAt ?? now,
      updated_at: updatedAt ?? null,
      is_deleted: isDeleted,
    });

    if (error) throw new Error(`Supabase addHistory failed: ${error.message}`);
  }

  async getHistory(memoryId: string): Promise<HistoryEntry[]> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select("*")
      .eq("memory_id", memoryId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Supabase getHistory failed: ${error.message}`);

    return (data ?? []).map(
      (row: Record<string, any>): HistoryEntry => ({
        id: String(row.id),
        memoryId: String(row.memory_id),
        previousValue: row.previous_value ?? null,
        newValue: row.new_value ?? null,
        action: String(row.action),
        createdAt: String(row.created_at),
        updatedAt: row.updated_at ? String(row.updated_at) : null,
        isDeleted: Number(row.is_deleted ?? 0),
      }),
    );
  }

  async reset(): Promise<void> {
    const { error } = await this.client
      .from(this.tableName)
      .delete()
      .neq("id", "");

    if (error) throw new Error(`Supabase reset failed: ${error.message}`);
  }

  close(): void {
    // Supabase client does not require explicit cleanup
  }
}
