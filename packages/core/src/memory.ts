import { createHash, randomUUID } from "node:crypto";
import type {
  AddMemoryOptions,
  DeleteAllMemoryOptions,
  GetAllMemoryOptions,
  MemoryConfig,
  MemoryItem,
  SearchMemoryOptions,
  SearchResult,
} from "./config";
import type { Embedder } from "./embedder";
import type { HistoryManager } from "./history";
import { NoopHistoryManager } from "./history";
import type { LLM } from "./llm";
import type { Message } from "./llm";
import {
  getFactRetrievalMessages,
  getUpdateMemoryMessages,
  removeCodeBlocks,
} from "./prompts";
import type { SearchFilters, VectorStore } from "./vector-store";

export interface MemoryDependencies {
  embedder: Embedder;
  vectorStore: VectorStore;
  llm: LLM;
  historyManager?: HistoryManager;
  config?: Partial<MemoryConfig>;
}

export class Memory {
  private embedder: Embedder;
  private vectorStore: VectorStore;
  private llm: LLM;
  private db: HistoryManager;
  private customPrompt?: string;

  constructor(deps: MemoryDependencies) {
    this.embedder = deps.embedder;
    this.vectorStore = deps.vectorStore;
    this.llm = deps.llm;
    this.db = deps.historyManager ?? new NoopHistoryManager();
    this.customPrompt = deps.config?.customPrompt;
  }

  async add(
    messages: string | Message[],
    config: AddMemoryOptions,
  ): Promise<SearchResult> {
    const {
      userId,
      agentId,
      runId,
      metadata = {},
      filters = {},
      infer = true,
    } = config;

    if (userId) filters.userId = metadata.userId = userId;
    if (agentId) filters.agentId = metadata.agentId = agentId;
    if (runId) filters.runId = metadata.runId = runId;

    if (!filters.userId && !filters.agentId && !filters.runId) {
      throw new Error(
        "One of the filters: userId, agentId or runId is required!",
      );
    }

    const parsedMessages: Message[] = Array.isArray(messages)
      ? messages
      : [{ role: "user", content: messages }];

    const vectorStoreResult = await this._addToVectorStore(
      parsedMessages,
      metadata,
      filters as SearchFilters,
      infer,
    );

    return { results: vectorStoreResult };
  }

  private async _addToVectorStore(
    messages: Message[],
    metadata: Record<string, any>,
    filters: SearchFilters,
    infer: boolean,
  ): Promise<MemoryItem[]> {
    if (!infer) {
      const results: MemoryItem[] = [];
      for (const message of messages) {
        if (typeof message.content !== "string") continue;
        const memoryId = await this._createMemory(
          message.content,
          {},
          metadata,
        );
        results.push({
          id: memoryId,
          memory: message.content,
          metadata: { event: "ADD" },
        });
      }
      return results;
    }

    const text = messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");

    const [systemPrompt, userPrompt] = this.customPrompt
      ? [
          this.customPrompt.toLowerCase().includes("json")
            ? this.customPrompt
            : `${this.customPrompt}\n\nYou MUST return a valid JSON object with a 'facts' key containing an array of strings.`,
          `Input:\n${text}`,
        ]
      : getFactRetrievalMessages(text);

    const response = await this.llm.generateResponse(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { type: "json_object" },
    );

    const cleanResponse = removeCodeBlocks(response as string);
    let facts: string[] = [];
    try {
      facts = JSON.parse(cleanResponse).facts ?? [];
    } catch {
      facts = [];
    }

    // Build embeddings and find similar existing memories
    const newEmbeddings: Record<string, number[]> = {};
    const existingMemories: Array<{ id: string; text: string }> = [];

    for (const fact of facts) {
      const embedding = await this.embedder.embed(fact);
      newEmbeddings[fact] = embedding;

      const similar = await this.vectorStore.search(embedding, 5, filters);
      for (const mem of similar) {
        existingMemories.push({ id: mem.id, text: mem.payload.data });
      }
    }

    // Deduplicate
    const unique = existingMemories.filter(
      (mem, i) => existingMemories.findIndex((m) => m.id === mem.id) === i,
    );

    // Map to temp IDs to avoid UUID hallucinations from LLM
    const idMap: Record<string, string> = {};
    unique.forEach((item, idx) => {
      idMap[String(idx)] = item.id;
      unique[idx]!.id = String(idx);
    });

    const updatePrompt = getUpdateMemoryMessages(unique, facts);
    const updateResponse = await this.llm.generateResponse(
      [{ role: "user", content: updatePrompt }],
      { type: "json_object" },
    );

    let actions: any[] = [];
    try {
      actions =
        JSON.parse(removeCodeBlocks(updateResponse as string)).memory ?? [];
    } catch {
      actions = [];
    }

    const results: MemoryItem[] = [];
    for (const action of actions) {
      try {
        switch (action.event) {
          case "ADD": {
            const id = await this._createMemory(
              action.text,
              newEmbeddings,
              metadata,
            );
            results.push({
              id,
              memory: action.text,
              metadata: { event: "ADD" },
            });
            break;
          }
          case "UPDATE": {
            const realId = idMap[action.id]!;
            await this._updateMemory(
              realId,
              action.text,
              newEmbeddings,
              metadata,
            );
            results.push({
              id: realId,
              memory: action.text,
              metadata: { event: "UPDATE", previousMemory: action.old_memory },
            });
            break;
          }
          case "DELETE": {
            const realId = idMap[action.id]!;
            await this._deleteMemory(realId);
            results.push({
              id: realId,
              memory: action.text,
              metadata: { event: "DELETE" },
            });
            break;
          }
        }
      } catch (error) {
        console.error(`Error processing memory action:`, error);
      }
    }

    return results;
  }

  async search(
    query: string,
    config: SearchMemoryOptions,
  ): Promise<SearchResult> {
    const { userId, agentId, runId, limit = 100, filters = {} } = config;

    if (userId) filters.userId = userId;
    if (agentId) filters.agentId = agentId;
    if (runId) filters.runId = runId;

    if (!filters.userId && !filters.agentId && !filters.runId) {
      throw new Error(
        "One of the filters: userId, agentId or runId is required!",
      );
    }

    const embedding = await this.embedder.embed(query);
    const memories = await this.vectorStore.search(
      embedding,
      limit,
      filters as SearchFilters,
    );

    const excludedKeys = new Set([
      "userId",
      "agentId",
      "runId",
      "hash",
      "data",
      "createdAt",
      "updatedAt",
    ]);

    const results = memories.map((mem) => ({
      id: mem.id,
      memory: mem.payload.data,
      hash: mem.payload.hash,
      createdAt: mem.payload.createdAt,
      updatedAt: mem.payload.updatedAt,
      score: mem.score,
      metadata: Object.fromEntries(
        Object.entries(mem.payload).filter(([key]) => !excludedKeys.has(key)),
      ),
      ...(mem.payload.userId && { userId: mem.payload.userId }),
      ...(mem.payload.agentId && { agentId: mem.payload.agentId }),
      ...(mem.payload.runId && { runId: mem.payload.runId }),
    }));

    return { results };
  }

  async get(memoryId: string): Promise<MemoryItem | null> {
    const memory = await this.vectorStore.get(memoryId);
    if (!memory) return null;

    const excludedKeys = new Set([
      "userId",
      "agentId",
      "runId",
      "hash",
      "data",
      "createdAt",
      "updatedAt",
    ]);

    return {
      id: memory.id,
      memory: memory.payload.data,
      hash: memory.payload.hash,
      createdAt: memory.payload.createdAt,
      updatedAt: memory.payload.updatedAt,
      metadata: Object.fromEntries(
        Object.entries(memory.payload).filter(
          ([key]) => !excludedKeys.has(key),
        ),
      ),
      ...(memory.payload.userId && { userId: memory.payload.userId }),
      ...(memory.payload.agentId && { agentId: memory.payload.agentId }),
      ...(memory.payload.runId && { runId: memory.payload.runId }),
    };
  }

  async update(memoryId: string, data: string): Promise<{ message: string }> {
    const embedding = await this.embedder.embed(data);
    await this._updateMemory(memoryId, data, { [data]: embedding });
    return { message: "Memory updated successfully!" };
  }

  async delete(memoryId: string): Promise<{ message: string }> {
    await this._deleteMemory(memoryId);
    return { message: "Memory deleted successfully!" };
  }

  async deleteAll(
    config: DeleteAllMemoryOptions,
  ): Promise<{ message: string }> {
    const { userId, agentId, runId } = config;
    const filters: SearchFilters = {};
    if (userId) filters.userId = userId;
    if (agentId) filters.agentId = agentId;
    if (runId) filters.runId = runId;

    if (!Object.keys(filters).length) {
      throw new Error(
        "At least one filter is required. Use reset() to delete all memories.",
      );
    }

    const [memories] = await this.vectorStore.list(filters);
    for (const memory of memories) {
      await this._deleteMemory(memory.id);
    }

    return { message: "Memories deleted successfully!" };
  }

  async getAll(config: GetAllMemoryOptions): Promise<SearchResult> {
    const { userId, agentId, runId, limit = 100 } = config;
    const filters: SearchFilters = {};
    if (userId) filters.userId = userId;
    if (agentId) filters.agentId = agentId;
    if (runId) filters.runId = runId;

    const [memories] = await this.vectorStore.list(filters, limit);

    const excludedKeys = new Set([
      "userId",
      "agentId",
      "runId",
      "hash",
      "data",
      "createdAt",
      "updatedAt",
    ]);

    const results = memories.map((mem) => ({
      id: mem.id,
      memory: mem.payload.data,
      hash: mem.payload.hash,
      createdAt: mem.payload.createdAt,
      updatedAt: mem.payload.updatedAt,
      metadata: Object.fromEntries(
        Object.entries(mem.payload).filter(([key]) => !excludedKeys.has(key)),
      ),
      ...(mem.payload.userId && { userId: mem.payload.userId }),
      ...(mem.payload.agentId && { agentId: mem.payload.agentId }),
      ...(mem.payload.runId && { runId: mem.payload.runId }),
    }));

    return { results };
  }

  async history(memoryId: string): Promise<any[]> {
    return this.db.getHistory(memoryId);
  }

  async reset(): Promise<void> {
    await this.db.reset();
    await this.vectorStore.deleteCol();
  }

  // --- Private helpers ---

  private async _createMemory(
    data: string,
    existingEmbeddings: Record<string, number[]>,
    metadata: Record<string, any>,
  ): Promise<string> {
    const memoryId = randomUUID();
    const embedding =
      existingEmbeddings[data] ?? (await this.embedder.embed(data));

    const memoryMetadata = {
      ...metadata,
      data,
      hash: createHash("md5").update(data).digest("hex"),
      createdAt: new Date().toISOString(),
    };

    await this.vectorStore.insert([embedding], [memoryId], [memoryMetadata]);
    await this.db.addHistory(
      memoryId,
      null,
      data,
      "ADD",
      memoryMetadata.createdAt,
    );

    return memoryId;
  }

  private async _updateMemory(
    memoryId: string,
    data: string,
    existingEmbeddings: Record<string, number[]>,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    const existing = await this.vectorStore.get(memoryId);
    if (!existing) {
      throw new Error(`Memory with ID ${memoryId} not found`);
    }

    const prevValue = existing.payload.data;
    const embedding =
      existingEmbeddings[data] ?? (await this.embedder.embed(data));

    const newMetadata = {
      ...metadata,
      data,
      hash: createHash("md5").update(data).digest("hex"),
      createdAt: existing.payload.createdAt,
      updatedAt: new Date().toISOString(),
      ...(existing.payload.userId && { userId: existing.payload.userId }),
      ...(existing.payload.agentId && { agentId: existing.payload.agentId }),
      ...(existing.payload.runId && { runId: existing.payload.runId }),
    };

    await this.vectorStore.update(memoryId, embedding, newMetadata);
    await this.db.addHistory(
      memoryId,
      prevValue,
      data,
      "UPDATE",
      newMetadata.createdAt,
      newMetadata.updatedAt,
    );
  }

  private async _deleteMemory(memoryId: string): Promise<void> {
    const existing = await this.vectorStore.get(memoryId);
    if (!existing) {
      throw new Error(`Memory with ID ${memoryId} not found`);
    }

    await this.vectorStore.delete(memoryId);
    await this.db.addHistory(
      memoryId,
      existing.payload.data,
      null,
      "DELETE",
      undefined,
      undefined,
      1,
    );
  }
}
