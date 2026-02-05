import {
  LLM,
  type LLMConfig,
  type LLMResponseFormat,
  type Message,
  type Tool,
} from "@mem0-community/core";
import { Mistral } from "@mistralai/mistralai";

export interface MistralLLMConfig extends LLMConfig {
  apiKey: string;
  model?: string;
}

interface ContentChunk {
  type: string;
  text: string;
}

function contentToString(
  content: string | ContentChunk[] | null | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((chunk) => chunk.type === "text")
      .map((chunk) => chunk.text)
      .join("");
  }
  return "";
}

export class MistralLLM extends LLM {
  private client: Mistral;
  private model: string;

  constructor(config: MistralLLMConfig) {
    super(config);
    this.client = new Mistral({
      apiKey: config.apiKey,
    });
    this.model = config.model ?? "mistral-tiny-latest";
  }

  async generateResponse(
    messages: Message[],
    responseFormat?: LLMResponseFormat,
    tools?: Tool[],
  ): Promise<string | Record<string, unknown>> {
    const response = await this.client.chat.complete({
      model: this.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
      })),
      ...(responseFormat && {
        responseFormat: responseFormat as { type: "text" | "json_object" },
      }),
      ...(tools && { tools, toolChoice: "auto" as const }),
    });

    const choice = response.choices?.[0];
    if (!choice) return "";

    const message = choice.message;

    if (message.toolCalls && message.toolCalls.length > 0) {
      return {
        content: contentToString(
          message.content as string | ContentChunk[] | null,
        ),
        role: message.role,
        toolCalls: message.toolCalls.map((call) => ({
          name: call.function.name,
          arguments: call.function.arguments,
        })),
      };
    }

    return contentToString(message.content as string | ContentChunk[] | null);
  }
}
