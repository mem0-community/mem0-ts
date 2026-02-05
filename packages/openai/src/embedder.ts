import { Embedder, type EmbedderConfig } from "@mem0-community/core";
import OpenAI from "openai";

export interface OpenAIEmbedderConfig extends EmbedderConfig {
  apiKey: string;
  model?: string;
  embeddingDims?: number;
  baseURL?: string;
}

export class OpenAIEmbedder extends Embedder {
  private openai: OpenAI;
  private model: string;

  constructor(config: OpenAIEmbedderConfig) {
    super(config);
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL && { baseURL: config.baseURL }),
    });
    this.model = config.model ?? "text-embedding-3-small";
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0]!.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map((item) => item.embedding);
  }
}
