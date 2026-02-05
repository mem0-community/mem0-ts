import {
  LLM,
  type LLMConfig,
  type LLMResponseFormat,
  type Message,
  type Tool,
} from "@mem0-community/core";
import Groq from "groq-sdk";

export interface GroqLLMConfig extends LLMConfig {
  apiKey: string;
  model?: string;
}

export class GroqLLM extends LLM {
  private client: Groq;
  private model: string;

  constructor(config: GroqLLMConfig) {
    super(config);
    this.client = new Groq({
      apiKey: config.apiKey,
    });
    this.model = config.model ?? "llama3-70b-8192";
  }

  async generateResponse(
    messages: Message[],
    responseFormat?: LLMResponseFormat,
    _tools?: Tool[],
  ): Promise<string | Record<string, unknown>> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((msg) => ({
        role: msg.role as "system" | "user" | "assistant",
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
      })),
      response_format: responseFormat as { type: "text" | "json_object" },
    });

    return response.choices[0]!.message.content || "";
  }
}
