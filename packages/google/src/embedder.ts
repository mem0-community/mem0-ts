import { Embedder, type EmbedderConfig } from "@mem0-community/core";
import { GoogleGenAI } from "@google/genai";

export interface GoogleEmbedderConfig extends EmbedderConfig {
  apiKey: string;
  model?: string;
  embeddingDims?: number;
}

export class GoogleEmbedder extends Embedder {
  private google: GoogleGenAI;
  private model: string;
  private embeddingDims: number;

  constructor(config: GoogleEmbedderConfig) {
    super(config);
    this.google = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model ?? "gemini-embedding-001";
    this.embeddingDims = config.embeddingDims ?? 1536;
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.google.models.embedContent({
      model: this.model,
      contents: text,
      config: { outputDimensionality: this.embeddingDims },
    });
    return response.embeddings![0]!.values!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.google.models.embedContent({
      model: this.model,
      contents: texts,
      config: { outputDimensionality: this.embeddingDims },
    });
    return response.embeddings!.map((e) => e.values!);
  }
}
