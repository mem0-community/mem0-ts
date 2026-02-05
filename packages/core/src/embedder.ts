export interface EmbedderConfig {
  apiKey?: string;
  model?: string;
  embeddingDims?: number;
  [key: string]: unknown;
}

export abstract class Embedder {
  protected config: EmbedderConfig;

  constructor(config: EmbedderConfig) {
    this.config = config;
  }

  abstract embed(text: string): Promise<number[]>;
  abstract embedBatch(texts: string[]): Promise<number[][]>;
}
