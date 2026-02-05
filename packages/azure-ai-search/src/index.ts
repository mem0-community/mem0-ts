import {
  VectorStore,
  type SearchFilters,
  type VectorStoreConfig,
  type VectorStoreResult,
} from "@mem0-community/core";
import {
  SearchClient,
  SearchIndexClient,
  AzureKeyCredential,
  type SearchIndex,
} from "@azure/search-documents";
import { DefaultAzureCredential } from "@azure/identity";

export interface AzureAISearchConfig extends VectorStoreConfig {
  serviceName: string;
  collectionName: string;
  apiKey?: string;
  embeddingModelDims: number;
  compressionType?: "scalar" | "binary";
  useFloat16?: boolean;
  hybridSearch?: boolean;
  vectorFilterMode?: "preFilter" | "postFilter";
}

interface AzureSearchDocument {
  id: string;
  embedding: number[];
  payload: string;
  userId: string;
  agentId: string;
  runId: string;
  hash: string;
  createdAt: number;
  updatedAt: number;
}

export class AzureAISearchVectorStore extends VectorStore {
  private searchClient: SearchClient<AzureSearchDocument>;
  private indexClient: SearchIndexClient;
  private readonly collectionName: string;
  private readonly embeddingModelDims: number;
  private readonly hybridSearch: boolean;
  private readonly vectorFilterMode: string;
  private initialized = false;

  constructor(config: AzureAISearchConfig) {
    super(config);
    this.collectionName = config.collectionName;
    this.embeddingModelDims = config.embeddingModelDims;
    this.hybridSearch = config.hybridSearch ?? false;
    this.vectorFilterMode = config.vectorFilterMode ?? "preFilter";

    const endpoint = `https://${config.serviceName}.search.windows.net`;
    const credential = config.apiKey
      ? new AzureKeyCredential(config.apiKey)
      : new DefaultAzureCredential();

    this.indexClient = new SearchIndexClient(endpoint, credential as any);
    this.searchClient = new SearchClient<AzureSearchDocument>(
      endpoint,
      this.collectionName,
      credential as any,
    );

    this._initialize().catch(console.error);
  }

  private _buildODataFilter(filters?: SearchFilters): string | undefined {
    if (!filters) return undefined;
    const parts: string[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;
      if (typeof value === "string") {
        parts.push(`${key} eq '${value.replace(/'/g, "''")}'`);
      } else if (typeof value === "number") {
        parts.push(`${key} eq ${value}`);
      } else if (typeof value === "boolean") {
        parts.push(`${key} eq ${value}`);
      } else if (
        typeof value === "object" &&
        value !== null &&
        "gte" in value &&
        "lte" in value
      ) {
        const range = value as { gte: number; lte: number };
        parts.push(`${key} ge ${range.gte} and ${key} le ${range.lte}`);
      }
    }
    return parts.length > 0 ? parts.join(" and ") : undefined;
  }

  async insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, any>[],
  ): Promise<void> {
    await this._initialize();

    const documents = vectors.map((vector, idx) => {
      const payload = payloads[idx] ?? {};
      const now = Date.now();
      return {
        id: ids[idx]!,
        embedding: vector,
        payload: JSON.stringify(payload),
        userId: String(payload.userId ?? payload.user_id ?? ""),
        agentId: String(payload.agentId ?? payload.agent_id ?? ""),
        runId: String(payload.runId ?? payload.run_id ?? ""),
        hash: String(payload.hash ?? ""),
        createdAt: Number(payload.createdAt ?? payload.created_at ?? now),
        updatedAt: Number(payload.updatedAt ?? payload.updated_at ?? now),
      };
    });

    await this.searchClient.mergeOrUploadDocuments(documents);
  }

  async search(
    query: number[],
    limit = 5,
    filters?: SearchFilters,
  ): Promise<VectorStoreResult[]> {
    await this._initialize();

    const filterExpression = this._buildODataFilter(filters);
    const results: VectorStoreResult[] = [];

    const searchOptions: Record<string, any> = {
      vectorSearchOptions: {
        queries: [
          {
            kind: "vector",
            vector: query,
            fields: ["embedding"],
            kNearestNeighborsCount: limit,
          },
        ],
        filterMode: this.vectorFilterMode,
      },
      top: limit,
      select: ["id", "payload", "userId", "agentId", "runId", "hash"],
    };

    if (filterExpression) {
      searchOptions.filter = filterExpression;
    }

    const searchText = this.hybridSearch ? "*" : undefined;
    const response = await this.searchClient.search(searchText, searchOptions);

    for await (const result of response.results) {
      const doc = result.document;
      let payload: Record<string, any>;
      try {
        payload = JSON.parse(doc.payload);
      } catch {
        payload = {};
      }
      results.push({
        id: doc.id,
        payload,
        score: result.score,
      });
    }

    return results;
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    await this._initialize();

    try {
      const doc = await this.searchClient.getDocument(vectorId);
      let payload: Record<string, any>;
      try {
        payload = JSON.parse(doc.payload);
      } catch {
        payload = {};
      }
      return { id: doc.id, payload };
    } catch {
      return null;
    }
  }

  async update(
    vectorId: string,
    vector: number[],
    payload: Record<string, any>,
  ): Promise<void> {
    await this._initialize();

    const now = Date.now();
    const document: AzureSearchDocument = {
      id: vectorId,
      embedding: vector,
      payload: JSON.stringify(payload),
      userId: String(payload.userId ?? payload.user_id ?? ""),
      agentId: String(payload.agentId ?? payload.agent_id ?? ""),
      runId: String(payload.runId ?? payload.run_id ?? ""),
      hash: String(payload.hash ?? ""),
      createdAt: Number(payload.createdAt ?? payload.created_at ?? now),
      updatedAt: now,
    };

    await this.searchClient.mergeOrUploadDocuments([document]);
  }

  async delete(vectorId: string): Promise<void> {
    await this._initialize();
    await this.searchClient.deleteDocuments([{ id: vectorId } as any]);
  }

  async deleteCol(): Promise<void> {
    try {
      await this.indexClient.deleteIndex(this.collectionName);
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

    const filterExpression = this._buildODataFilter(filters);
    const results: VectorStoreResult[] = [];

    const searchOptions: Record<string, any> = {
      top: limit,
      select: ["id", "payload", "userId", "agentId", "runId", "hash"],
    };

    if (filterExpression) {
      searchOptions.filter = filterExpression;
    }

    const response = await this.searchClient.search("*", searchOptions);

    for await (const result of response.results) {
      const doc = result.document;
      let payload: Record<string, any>;
      try {
        payload = JSON.parse(doc.payload);
      } catch {
        payload = {};
      }
      results.push({ id: doc.id, payload });
    }

    return [results, results.length];
  }

  async getUserId(): Promise<string> {
    return crypto.randomUUID();
  }

  private async _initialize(): Promise<void> {
    if (this.initialized) return;

    const config = this.config as AzureAISearchConfig;

    const vectorSearchConfig: Record<string, any> = {
      algorithms: [
        {
          name: "hnsw-algo",
          kind: "hnsw",
          parameters: {
            metric: "cosine",
            m: 4,
            efConstruction: 400,
            efSearch: 500,
          },
        },
      ],
      profiles: [
        { name: "vector-profile", algorithmConfigurationName: "hnsw-algo" },
      ],
    };

    if (config.compressionType) {
      const compressions: Record<string, any>[] = [];
      if (config.compressionType === "scalar") {
        compressions.push({
          name: "scalar-compression",
          kind: "scalarQuantization",
        });
      } else if (config.compressionType === "binary") {
        compressions.push({
          name: "binary-compression",
          kind: "binaryQuantization",
        });
      }
      vectorSearchConfig.compressions = compressions;
      vectorSearchConfig.profiles[0].compressionName = compressions[0]?.name;
    }

    const fields: Record<string, any>[] = [
      { name: "id", type: "Edm.String", key: true, filterable: true },
      {
        name: "embedding",
        type: `Collection(Edm.${config.useFloat16 ? "Half" : "Single"})`,
        searchable: true,
        vectorSearchDimensions: this.embeddingModelDims,
        vectorSearchProfileName: "vector-profile",
      },
      { name: "payload", type: "Edm.String", searchable: true },
      {
        name: "userId",
        type: "Edm.String",
        filterable: true,
        searchable: false,
      },
      {
        name: "agentId",
        type: "Edm.String",
        filterable: true,
        searchable: false,
      },
      {
        name: "runId",
        type: "Edm.String",
        filterable: true,
        searchable: false,
      },
      {
        name: "hash",
        type: "Edm.String",
        filterable: true,
        searchable: false,
      },
      {
        name: "createdAt",
        type: "Edm.Int64",
        filterable: true,
        sortable: true,
      },
      {
        name: "updatedAt",
        type: "Edm.Int64",
        filterable: true,
        sortable: true,
      },
    ];

    const indexDefinition: SearchIndex = {
      name: this.collectionName,
      fields,
      vectorSearch: vectorSearchConfig,
    } as any;

    try {
      await this.indexClient.getIndex(this.collectionName);
    } catch {
      await this.indexClient.createIndex(indexDefinition);
    }

    this.initialized = true;
  }
}
