import { z } from "zod";

export const MemoryConfigSchema = z.object({
  version: z.string().optional().default("v1.1"),
  customPrompt: z.string().optional(),
  disableHistory: z.boolean().optional().default(false),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export interface MemoryItem {
  id: string;
  memory: string;
  hash?: string;
  createdAt?: string;
  updatedAt?: string;
  score?: number;
  metadata?: Record<string, any>;
  userId?: string;
  agentId?: string;
  runId?: string;
}

export interface SearchResult {
  results: MemoryItem[];
  relations?: any[];
}

export interface AddMemoryOptions {
  userId?: string;
  agentId?: string;
  runId?: string;
  metadata?: Record<string, any>;
  filters?: Record<string, any>;
  infer?: boolean;
}

export interface SearchMemoryOptions {
  userId?: string;
  agentId?: string;
  runId?: string;
  limit?: number;
  filters?: Record<string, any>;
}

export interface DeleteAllMemoryOptions {
  userId?: string;
  agentId?: string;
  runId?: string;
}

export interface GetAllMemoryOptions {
  userId?: string;
  agentId?: string;
  runId?: string;
  limit?: number;
}
