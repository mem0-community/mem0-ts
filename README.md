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

## Bundle Size Comparison

The official `mem0ai` ships as a single 1.17 MB package that eagerly imports **all** providers — including native addons like `sqlite3` (3.3 MB) that crash serverless runtimes.

With `@mem0-community`, you install only what you need:

| Setup | Packages | Package Size | Native Deps |
|-------|----------|-------------|-------------|
| **Official** `mem0ai` (all-in-one) | 1 | 1,170 kB | `sqlite3` (3.3 MB), `pg`, `uuid`, `axios` |
| **Community** core + OpenAI + Qdrant | 3 | **37 kB** | None |
| **Community** core + Anthropic + Redis | 3 | **41 kB** | None |
| **Community** core only | 1 | **30 kB** | None |

<details>
<summary>Per-package sizes</summary>

| Package | Packed | Unpacked |
|---------|--------|----------|
| `@mem0-community/core` | 30.2 kB | 155.2 kB |
| `@mem0-community/openai` | 2.9 kB | 17.3 kB |
| `@mem0-community/anthropic` | 3.0 kB | 16.0 kB |
| `@mem0-community/google` | 2.7 kB | 15.7 kB |
| `@mem0-community/azure-openai` | 3.1 kB | 19.0 kB |
| `@mem0-community/groq` | 2.1 kB | 8.1 kB |
| `@mem0-community/mistral` | 2.7 kB | 13.5 kB |
| `@mem0-community/ollama` | 3.5 kB | 24.7 kB |
| `@mem0-community/qdrant` | 4.2 kB | 27.9 kB |
| `@mem0-community/pgvector` | 4.5 kB | 30.2 kB |
| `@mem0-community/redis` | 7.5 kB | 57.7 kB |
| `@mem0-community/supabase` | 5.5 kB | 40.5 kB |
| `@mem0-community/azure-ai-search` | 7.9 kB | 59.1 kB |
| `@mem0-community/cloudflare-vectorize` | 6.5 kB | 41.9 kB |

</details>

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
