// Interfaces
export { Embedder } from "./embedder";
export type { EmbedderConfig } from "./embedder";

export { LLM } from "./llm";
export type { LLMConfig, LLMResponseFormat, Message, Tool } from "./llm";

export { VectorStore } from "./vector-store";
export type {
  SearchFilters,
  VectorStoreConfig,
  VectorStoreResult,
} from "./vector-store";

export type { HistoryManager, HistoryEntry } from "./history";
export { NoopHistoryManager, InMemoryHistoryManager } from "./history";

// Memory
export { Memory } from "./memory";
export type { MemoryDependencies } from "./memory";

// Config & Types
export type {
  MemoryConfig,
  MemoryItem,
  SearchResult,
  AddMemoryOptions,
  SearchMemoryOptions,
  DeleteAllMemoryOptions,
  GetAllMemoryOptions,
} from "./config";

// Prompts (for custom implementations)
export {
  getFactRetrievalMessages,
  getUpdateMemoryMessages,
  removeCodeBlocks,
} from "./prompts";
