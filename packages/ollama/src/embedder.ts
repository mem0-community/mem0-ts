import { Embedder, type EmbedderConfig } from "@mem0-community/core";
import { Ollama } from "ollama";

export interface OllamaEmbedderConfig extends EmbedderConfig {
  host?: string;
  model?: string;
  embeddingDims?: number;
}

export class OllamaEmbedder extends Embedder {
  private ollama: Ollama;
  private model: string;
  private initialized = false;

  constructor(config: OllamaEmbedderConfig = {}) {
    super(config);
    this.ollama = new Ollama({ host: config.host ?? "http://localhost:11434" });
    this.model = config.model ?? "nomic-embed-text:latest";
    this.ensureModelExists().catch(() => {});
  }

  async embed(text: string): Promise<number[]> {
    await this.ensureModelExists();
    const response = await this.ollama.embeddings({
      model: this.model,
      prompt: text,
    });
    return response.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureModelExists();
    return Promise.all(
      texts.map(async (text) => {
        const response = await this.ollama.embeddings({
          model: this.model,
          prompt: text,
        });
        return response.embedding;
      }),
    );
  }

  private async ensureModelExists(): Promise<void> {
    if (this.initialized) return;
    const { models } = await this.ollama.list();
    const exists = models.some((m) => m.name === this.model);
    if (!exists) {
      await this.ollama.pull({ model: this.model });
    }
    this.initialized = true;
  }
}
