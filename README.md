# mem0-community/mem0-ts

[![npm version](https://img.shields.io/npm/v/@mem0-community/core.svg)](https://www.npmjs.com/package/@mem0-community/core)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

Community-maintained TypeScript rewrite of [mem0](https://github.com/mem0ai/mem0) — a self-improving memory layer for LLM applications.

## Why this fork?

The official `mem0-ts` bundles **all** providers into a single package. This means importing `Memory` eagerly loads `sqlite3`, `pg`, and every other native addon — even if you only need Qdrant + OpenAI. This **breaks serverless environments** (AWS Lambda, Cloudflare Workers) where native addons either don't exist or blow past size limits. See [mem0ai/mem0#3291](https://github.com/mem0ai/mem0/issues/3291).

**This rewrite solves it** with a LangChain-style modular architecture: one npm package per provider, explicit dependency injection, zero native dependencies in core.

## Architecture

```
@mem0-community/core          # Memory class, abstract bases, zero native deps
@mem0-community/openai        # OpenAI LLM + Embedder
@mem0-community/anthropic     # Anthropic LLM
@mem0-community/google        # Google Gemini LLM + Embedder
@mem0-community/azure-openai  # Azure OpenAI LLM + Embedder
@mem0-community/groq          # Groq LLM
@mem0-community/mistral       # Mistral LLM + Embedder
@mem0-community/ollama        # Ollama LLM + Embedder (local)
@mem0-community/qdrant        # Qdrant vector store
@mem0-community/pgvector      # PostgreSQL + pgvector store
@mem0-community/redis         # Redis vector store + history
@mem0-community/supabase      # Supabase vector store + history
@mem0-community/azure-ai-search      # Azure AI Search vector store
@mem0-community/cloudflare-vectorize  # Cloudflare Vectorize store
```

## Quick Start

Install only what you need:

```bash
npm install @mem0-community/core @mem0-community/openai @mem0-community/qdrant
```

Wire it up with dependency injection:

```typescript
import { Memory } from "@mem0-community/core";
import { OpenAIEmbedder, OpenAILLM } from "@mem0-community/openai";
import { QdrantVectorStore } from "@mem0-community/qdrant";

const memory = new Memory({
  llm: new OpenAILLM({ apiKey: process.env.OPENAI_API_KEY! }),
  embedder: new OpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! }),
  vectorStore: new QdrantVectorStore({
    collectionName: "memories",
    url: "http://localhost:6333",
  }),
});

// Add a memory
await memory.add("I prefer TypeScript over JavaScript", {
  userId: "alice",
});

// Search memories
const results = await memory.search("What programming language does Alice like?", {
  userId: "alice",
});
```

## Design Principles

- **Import only what you use** — No eager loading of unused providers
- **Zero native dependencies in core** — Uses `node:crypto` instead of `uuid`, no `sqlite3`
- **Tree-shakeable** — Every package has `sideEffects: false`
- **Strict TypeScript** — No `any` types, full type safety
- **Aligned with official** — Same prompts, same LLM logic, same behavior

## Supported Providers

| Category | Providers |
|----------|-----------|
| **LLM** | OpenAI, Anthropic, Google Gemini, Azure OpenAI, Groq, Mistral, Ollama |
| **Embedder** | OpenAI, Google Gemini, Azure OpenAI, Mistral, Ollama |
| **Vector Store** | Qdrant, pgvector, Redis, Supabase, Azure AI Search, Cloudflare Vectorize |
| **History** | In-memory (built-in), Redis, Supabase |

## Development

```bash
pnpm install
pnpm build        # Build all packages
pnpm test         # Run tests
```

## License

Apache-2.0 — Same as the original [mem0](https://github.com/mem0ai/mem0) project.
