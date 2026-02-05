import { Embedder, type EmbedderConfig } from "@mem0-community/core";
import { AzureOpenAI } from "openai";

export interface AzureOpenAIEmbedderConfig extends EmbedderConfig {
  apiKey: string;
  endpoint: string;
  model?: string;
  embeddingDims?: number;
  [key: string]: unknown;
}

export class AzureOpenAIEmbedder extends Embedder {
  private client: AzureOpenAI;
  private model: string;

  constructor(config: AzureOpenAIEmbedderConfig) {
    super(config);
    const { apiKey, endpoint, model, embeddingDims, ...rest } = config;
    this.client = new AzureOpenAI({
      apiKey,
      endpoint,
      ...rest,
    });
    this.model = model ?? "text-embedding-3-small";
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0]!.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map((item) => item.embedding);
  }
}
