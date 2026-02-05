import {
  LLM,
  type LLMConfig,
  type LLMResponseFormat,
  type Message,
  type Tool,
} from "@mem0-community/core";
import { Ollama } from "ollama";

export interface OllamaLLMConfig extends LLMConfig {
  host?: string;
  model?: string;
}

export class OllamaLLM extends LLM {
  private ollama: Ollama;
  private model: string;
  private initialized = false;

  constructor(config: OllamaLLMConfig = {}) {
    super(config);
    this.ollama = new Ollama({ host: config.host ?? "http://localhost:11434" });
    this.model = config.model ?? "llama3.1:8b";
    this.ensureModelExists().catch(() => {});
  }

  async generateResponse(
    messages: Message[],
    responseFormat?: LLMResponseFormat,
    tools?: Tool[],
  ): Promise<string | Record<string, unknown>> {
    await this.ensureModelExists();

    const ollamaMessages = messages.map((msg) => ({
      role: msg.role,
      content:
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
    }));

    const response = await this.ollama.chat({
      model: this.model,
      messages: ollamaMessages,
      ...(responseFormat?.type === "json_object" && { format: "json" }),
      ...(tools && {
        tools: tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          },
        })),
      }),
    });

    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
      return {
        content: response.message.content ?? "",
        role: response.message.role,
        toolCalls: response.message.tool_calls.map((call) => ({
          name: call.function.name,
          arguments:
            typeof call.function.arguments === "string"
              ? call.function.arguments
              : JSON.stringify(call.function.arguments),
        })),
      };
    }

    return response.message.content ?? "";
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
