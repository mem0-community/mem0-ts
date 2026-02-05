import { describe, it, expect, vi, beforeEach } from "vitest";
import { Memory } from "../memory";
import type { Embedder } from "../embedder";
import type { LLM } from "../llm";
import type { VectorStore, VectorStoreResult } from "../vector-store";
import { InMemoryHistoryManager } from "../history";

// --- Mock implementations ---

function createMockEmbedder(): Embedder {
  return {
    config: {},
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedBatch: vi
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => [0.1, 0.2, 0.3])),
      ),
  } as unknown as Embedder;
}

function createMockVectorStore(): VectorStore & {
  _store: Map<string, VectorStoreResult>;
} {
  const store = new Map<string, VectorStoreResult>();

  return {
    config: {},
    _store: store,
    insert: vi
      .fn()
      .mockImplementation(
        async (
          _vectors: number[][],
          ids: string[],
          payloads: Record<string, any>[],
        ) => {
          ids.forEach((id, i) => {
            store.set(id, { id, payload: payloads[i] ?? {} });
          });
        },
      ),
    search: vi.fn().mockResolvedValue([]),
    get: vi
      .fn()
      .mockImplementation(async (id: string) => store.get(id) ?? null),
    update: vi
      .fn()
      .mockImplementation(
        async (id: string, _vector: number[], payload: Record<string, any>) => {
          store.set(id, { id, payload });
        },
      ),
    delete: vi.fn().mockImplementation(async (id: string) => {
      store.delete(id);
    }),
    deleteCol: vi.fn().mockImplementation(async () => {
      store.clear();
    }),
    list: vi.fn().mockImplementation(async () => {
      const items = [...store.values()];
      return [items, items.length] as [VectorStoreResult[], number];
    }),
    getUserId: vi.fn().mockResolvedValue("test-user"),
  } as unknown as VectorStore & { _store: Map<string, VectorStoreResult> };
}

/**
 * Creates a mock LLM that uses mockResolvedValueOnce chaining.
 * Call order: 1st = fact retrieval, 2nd = memory update.
 */
function createMockLLM(factsResponse: string, actionsResponse: string): LLM {
  const mock = vi.fn();
  mock.mockResolvedValueOnce(factsResponse);
  mock.mockResolvedValueOnce(actionsResponse);
  return {
    config: {},
    generateResponse: mock,
  } as unknown as LLM;
}

// --- Tests ---

describe("Memory", () => {
  let embedder: ReturnType<typeof createMockEmbedder>;
  let vectorStore: ReturnType<typeof createMockVectorStore>;
  let historyManager: InMemoryHistoryManager;

  beforeEach(() => {
    embedder = createMockEmbedder();
    vectorStore = createMockVectorStore();
    historyManager = new InMemoryHistoryManager();
  });

  function buildMemory(llm: LLM, customPrompt?: string): Memory {
    return new Memory({
      embedder,
      vectorStore,
      llm,
      historyManager,
      config: customPrompt ? { customPrompt } : undefined,
    });
  }

  describe("add", () => {
    it("requires at least one filter (userId/agentId/runId)", async () => {
      const llm = createMockLLM('{"facts":[]}', '{"memory":[]}');
      const memory = buildMemory(llm);
      await expect(memory.add("hello", {})).rejects.toThrow(
        "One of the filters",
      );
    });

    it("adds a memory via LLM-driven ADD", async () => {
      const llm = createMockLLM(
        '{"facts":["Name is Alice"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"Name is Alice"}]}',
      );
      const memory = buildMemory(llm);

      const result = await memory.add("My name is Alice", {
        userId: "user-1",
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.metadata?.event).toBe("ADD");
      expect(result.results[0]!.memory).toBe("Name is Alice");
    });

    it("calls LLM twice: fact retrieval + memory update", async () => {
      const llm = createMockLLM(
        '{"facts":["test"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"test"}]}',
      );
      const memory = buildMemory(llm);
      await memory.add("test", { userId: "user-1" });
      expect(llm.generateResponse).toHaveBeenCalledTimes(2);
    });

    it("embeds each extracted fact", async () => {
      const llm = createMockLLM(
        '{"facts":["Name is Alice"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"Name is Alice"}]}',
      );
      const memory = buildMemory(llm);
      await memory.add("test", { userId: "user-1" });
      expect(embedder.embed).toHaveBeenCalledWith("Name is Alice");
    });

    it("inserts into vector store", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      await memory.add("test", { userId: "user-1" });
      expect(vectorStore.insert).toHaveBeenCalled();
    });

    it("records history for ADD", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      const result = await memory.add("test", { userId: "user-1" });
      const id = result.results[0]!.id;
      const history = await historyManager.getHistory(id);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe("ADD");
    });

    it("supports infer=false to skip LLM", async () => {
      const llm = createMockLLM('{"facts":[]}', '{"memory":[]}');
      const memory = buildMemory(llm);
      const result = await memory.add("raw fact", {
        userId: "user-1",
        infer: false,
      });

      expect(llm.generateResponse).not.toHaveBeenCalled();
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.memory).toBe("raw fact");
    });

    it("supports infer=false with Message[] input", async () => {
      const llm = createMockLLM('{"facts":[]}', '{"memory":[]}');
      const memory = buildMemory(llm);
      const result = await memory.add(
        [
          { role: "user", content: "first" },
          { role: "assistant", content: "second" },
        ],
        { userId: "user-1", infer: false },
      );

      expect(result.results).toHaveLength(2);
      expect(result.results[0]!.memory).toBe("first");
      expect(result.results[1]!.memory).toBe("second");
    });

    it("handles LLM returning empty facts gracefully", async () => {
      const llm = createMockLLM('{"facts":[]}', '{"memory":[]}');
      const memory = buildMemory(llm);
      const result = await memory.add("nothing useful", {
        userId: "user-1",
      });
      expect(result.results).toHaveLength(0);
    });

    it("handles malformed LLM JSON gracefully", async () => {
      const llm = createMockLLM("I cannot help with that", "also garbage");
      const memory = buildMemory(llm);
      const result = await memory.add("test", { userId: "user-1" });
      expect(result.results).toHaveLength(0);
    });

    it("handles LLM returning code-fenced JSON", async () => {
      const llm = createMockLLM(
        '```json\n{"facts":["Likes coffee"]}\n```',
        '```json\n{"memory":[{"id":"1","event":"ADD","text":"Likes coffee"}]}\n```',
      );
      const memory = buildMemory(llm);
      const result = await memory.add("I like coffee", { userId: "user-1" });
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.memory).toBe("Likes coffee");
    });

    it("works with agentId instead of userId", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      const result = await memory.add("test", { agentId: "agent-1" });
      expect(result.results).toHaveLength(1);
    });
  });

  describe("add — LLM-driven UPDATE", () => {
    it("updates existing memory via LLM decision", async () => {
      // Step 1: Add initial memory
      const llmAdd = createMockLLM(
        '{"facts":["Likes pizza"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"Likes pizza"}]}',
      );
      let memory = buildMemory(llmAdd);
      const addResult = await memory.add("I like pizza", { userId: "u1" });
      const realId = addResult.results[0]!.id;

      // Step 2: Configure search to return the existing memory
      (vectorStore.search as any).mockResolvedValue([
        { id: realId, payload: { data: "Likes pizza" }, score: 0.95 },
      ]);

      // LLM decides to UPDATE — uses temp id "0" which maps to realId
      const llmUpdate = createMockLLM(
        '{"facts":["Loves pepperoni pizza"]}',
        '{"memory":[{"id":"0","event":"UPDATE","text":"Loves pepperoni pizza","old_memory":"Likes pizza"}]}',
      );
      memory = buildMemory(llmUpdate);

      const result = await memory.add("Actually I love pepperoni pizza", {
        userId: "u1",
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.metadata?.event).toBe("UPDATE");
      expect(result.results[0]!.metadata?.previousMemory).toBe("Likes pizza");
      expect(result.results[0]!.memory).toBe("Loves pepperoni pizza");
      expect(result.results[0]!.id).toBe(realId);
    });
  });

  describe("add — LLM-driven DELETE", () => {
    it("deletes existing memory via LLM decision", async () => {
      // Step 1: Add initial memory
      const llmAdd = createMockLLM(
        '{"facts":["Likes sushi"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"Likes sushi"}]}',
      );
      let memory = buildMemory(llmAdd);
      const addResult = await memory.add("I like sushi", { userId: "u1" });
      const realId = addResult.results[0]!.id;

      // Step 2: search returns existing memory
      (vectorStore.search as any).mockResolvedValue([
        { id: realId, payload: { data: "Likes sushi" }, score: 0.95 },
      ]);

      // LLM decides to DELETE — temp id "0"
      const llmDelete = createMockLLM(
        '{"facts":["Hates sushi now"]}',
        `{"memory":[{"id":"0","event":"DELETE","text":"Likes sushi"}]}`,
      );
      memory = buildMemory(llmDelete);

      const result = await memory.add("I hate sushi now", { userId: "u1" });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.metadata?.event).toBe("DELETE");
      expect(result.results[0]!.id).toBe(realId);
    });
  });

  describe("search", () => {
    it("requires at least one filter", async () => {
      const llm = createMockLLM('{"facts":[]}', '{"memory":[]}');
      const memory = buildMemory(llm);
      await expect(memory.search("query", {})).rejects.toThrow(
        "One of the filters",
      );
    });

    it("returns mapped results with correct structure", async () => {
      (vectorStore.search as any).mockResolvedValue([
        {
          id: "mem-1",
          payload: {
            data: "Likes TypeScript",
            hash: "abc123",
            createdAt: "2024-01-01",
            updatedAt: "2024-01-02",
            userId: "u1",
            customField: "custom",
          },
          score: 0.92,
        },
      ]);

      const llm = createMockLLM('{"facts":[]}', '{"memory":[]}');
      const memory = buildMemory(llm);
      const result = await memory.search("programming", {
        userId: "u1",
        limit: 5,
      });

      expect(result.results).toHaveLength(1);
      const item = result.results[0]!;
      expect(item.id).toBe("mem-1");
      expect(item.memory).toBe("Likes TypeScript");
      expect(item.hash).toBe("abc123");
      expect(item.createdAt).toBe("2024-01-01");
      expect(item.updatedAt).toBe("2024-01-02");
      expect(item.score).toBe(0.92);
      expect(item.userId).toBe("u1");
      // customField goes into metadata
      expect(item.metadata?.customField).toBe("custom");
      // excluded keys should NOT be in metadata
      expect(item.metadata?.data).toBeUndefined();
      expect(item.metadata?.hash).toBeUndefined();
    });
  });

  describe("get", () => {
    it("returns null for non-existent memory", async () => {
      const llm = createMockLLM('{"facts":[]}', '{"memory":[]}');
      const memory = buildMemory(llm);
      const result = await memory.get("non-existent");
      expect(result).toBeNull();
    });

    it("returns memory after add", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      const addResult = await memory.add("test", { userId: "user-1" });
      const id = addResult.results[0]!.id;
      const result = await memory.get(id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(id);
    });
  });

  describe("update", () => {
    it("updates existing memory", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      const addResult = await memory.add("test", { userId: "user-1" });
      const id = addResult.results[0]!.id;

      const result = await memory.update(id, "updated text");
      expect(result.message).toBe("Memory updated successfully!");
      expect(vectorStore.update).toHaveBeenCalled();
    });

    it("throws on non-existent memory", async () => {
      const llm = createMockLLM('{"facts":[]}', '{"memory":[]}');
      const memory = buildMemory(llm);
      await expect(memory.update("no-id", "text")).rejects.toThrow("not found");
    });

    it("records history for UPDATE", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      const addResult = await memory.add("test", { userId: "user-1" });
      const id = addResult.results[0]!.id;

      await memory.update(id, "updated text");
      const history = await historyManager.getHistory(id);
      expect(history.some((h) => h.action === "UPDATE")).toBe(true);
    });
  });

  describe("delete", () => {
    it("deletes a memory", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      const addResult = await memory.add("test", { userId: "user-1" });
      const id = addResult.results[0]!.id;

      await memory.delete(id);
      const result = await memory.get(id);
      expect(result).toBeNull();
    });

    it("throws on non-existent memory", async () => {
      const llm = createMockLLM('{"facts":[]}', '{"memory":[]}');
      const memory = buildMemory(llm);
      await expect(memory.delete("no-id")).rejects.toThrow("not found");
    });

    it("records history for DELETE", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      const addResult = await memory.add("test", { userId: "user-1" });
      const id = addResult.results[0]!.id;

      await memory.delete(id);
      const history = await historyManager.getHistory(id);
      expect(history.some((h) => h.action === "DELETE")).toBe(true);
    });
  });

  describe("getAll", () => {
    it("returns all memories for a user", async () => {
      // Add two memories
      const llm1 = createMockLLM(
        '{"facts":["Fact A"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"Fact A"}]}',
      );
      let memory = buildMemory(llm1);
      await memory.add("first", { userId: "u1" });

      const llm2 = createMockLLM(
        '{"facts":["Fact B"]}',
        '{"memory":[{"id":"2","event":"ADD","text":"Fact B"}]}',
      );
      memory = buildMemory(llm2);
      await memory.add("second", { userId: "u1" });

      const result = await memory.getAll({ userId: "u1" });
      expect(result.results).toHaveLength(2);
    });
  });

  describe("deleteAll", () => {
    it("requires at least one filter", async () => {
      const llm = createMockLLM('{"facts":[]}', '{"memory":[]}');
      const memory = buildMemory(llm);
      await expect(memory.deleteAll({})).rejects.toThrow(
        "At least one filter is required",
      );
    });

    it("deletes all memories matching filter", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      await memory.add("test", { userId: "u1" });

      const result = await memory.deleteAll({ userId: "u1" });
      expect(result.message).toContain("deleted");
    });
  });

  describe("history", () => {
    it("returns history for a memory", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      const addResult = await memory.add("test", { userId: "u1" });
      const id = addResult.results[0]!.id;

      const history = await memory.history(id);
      expect(history).toHaveLength(1);
      expect(history[0]!.action).toBe("ADD");
    });
  });

  describe("reset", () => {
    it("clears vector store and history", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      const addResult = await memory.add("test", { userId: "user-1" });
      const id = addResult.results[0]!.id;

      await memory.reset();

      expect(vectorStore.deleteCol).toHaveBeenCalled();
      // History should also be cleared
      const history = await historyManager.getHistory(id);
      expect(history).toHaveLength(0);
    });
  });

  describe("customPrompt", () => {
    it("uses custom prompt containing json keyword as-is", async () => {
      const llm = createMockLLM(
        '{"facts":["custom fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"custom fact"}]}',
      );
      const memory = buildMemory(
        llm,
        "Extract facts as json from the conversation.",
      );
      await memory.add("test", { userId: "u1" });

      const call = (llm.generateResponse as any).mock.calls[0];
      expect(call[0][0].content).toContain("Extract facts as json");
    });

    it("appends JSON instruction to custom prompt without json keyword", async () => {
      const llm = createMockLLM(
        '{"facts":["custom fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"custom fact"}]}',
      );
      const memory = buildMemory(llm, "Extract important information.");
      await memory.add("test", { userId: "u1" });

      const call = (llm.generateResponse as any).mock.calls[0];
      const systemContent = call[0][0].content;
      expect(systemContent).toContain("Extract important information");
      expect(systemContent).toContain("valid JSON");
    });
  });

  describe("add — NONE event", () => {
    it("ignores NONE actions from LLM", async () => {
      const llm = createMockLLM(
        '{"facts":["Name is Alice"]}',
        '{"memory":[{"id":"0","event":"NONE","text":"Name is Alice"}]}',
      );
      const memory = buildMemory(llm);

      // search returns existing memory so idMap is populated
      (vectorStore.search as any).mockResolvedValue([
        { id: "existing-id", payload: { data: "Name is Alice" }, score: 0.99 },
      ]);

      const result = await memory.add("My name is Alice", { userId: "u1" });
      // NONE should produce no result entries
      expect(result.results).toHaveLength(0);
      // No insert/update/delete should be called for NONE
      expect(vectorStore.insert).not.toHaveBeenCalled();
      expect(vectorStore.update).not.toHaveBeenCalled();
      expect(vectorStore.delete).not.toHaveBeenCalled();
    });
  });

  describe("runId filter", () => {
    it("add works with runId", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      const result = await memory.add("test", { runId: "run-1" });
      expect(result.results).toHaveLength(1);
    });

    it("search works with runId", async () => {
      const llm = createMockLLM('{"facts":[]}', '{"memory":[]}');
      const memory = buildMemory(llm);
      await memory.search("query", { runId: "run-1" });
      expect(vectorStore.search).toHaveBeenCalled();
    });

    it("deleteAll works with runId", async () => {
      const llm = createMockLLM(
        '{"facts":["fact"]}',
        '{"memory":[{"id":"1","event":"ADD","text":"fact"}]}',
      );
      const memory = buildMemory(llm);
      await memory.add("test", { runId: "run-1" });
      const result = await memory.deleteAll({ runId: "run-1" });
      expect(result.message).toContain("deleted");
    });
  });
});
