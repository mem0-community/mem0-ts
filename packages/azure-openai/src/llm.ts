import {
  LLM,
  type LLMConfig,
  type LLMResponseFormat,
  type Message,
  type Tool,
} from "@mem0-community/core";
import { AzureOpenAI } from "openai";

export interface AzureOpenAILLMConfig extends LLMConfig {
  apiKey: string;
  endpoint: string;
  model?: string;
  [key: string]: unknown;
}

export class AzureOpenAILLM extends LLM {
  private client: AzureOpenAI;
  private model: string;

  constructor(config: AzureOpenAILLMConfig) {
    super(config);

    if (!config.apiKey) {
      throw new Error("AzureOpenAILLM requires an apiKey");
    }
    if (!config.endpoint) {
      throw new Error("AzureOpenAILLM requires an endpoint");
    }

    const { apiKey, endpoint, model, ...rest } = config;
    this.client = new AzureOpenAI({
      apiKey,
      endpoint,
      ...rest,
    });
    this.model = model ?? "gpt-4";
  }

  async generateResponse(
    messages: Message[],
    responseFormat?: LLMResponseFormat,
    tools?: Tool[],
  ): Promise<string | Record<string, unknown>> {
    const completion = await this.client.chat.completions.create({
      messages: messages.map((msg) => ({
        role: msg.role,
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
      })),
      model: this.model,
      ...(responseFormat && {
        response_format: responseFormat as { type: "text" | "json_object" },
      }),
      ...(tools && { tools, tool_choice: "auto" as const }),
    });

    const response = completion.choices[0]!.message;

    if (response.tool_calls) {
      return {
        content: response.content ?? "",
        role: response.role,
        toolCalls: response.tool_calls.map((call) => ({
          name: call.function.name,
          arguments: call.function.arguments,
        })),
      };
    }

    return response.content ?? "";
  }
}
