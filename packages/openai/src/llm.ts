import {
  LLM,
  type LLMConfig,
  type LLMResponseFormat,
  type Message,
  type Tool,
} from "@mem0-community/core";
import OpenAI from "openai";

export interface OpenAILLMConfig extends LLMConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export class OpenAILLM extends LLM {
  private openai: OpenAI;
  private model: string;

  constructor(config: OpenAILLMConfig) {
    super(config);
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL && { baseURL: config.baseURL }),
    });
    this.model = config.model ?? "gpt-4.1-nano";
  }

  async generateResponse(
    messages: Message[],
    responseFormat?: LLMResponseFormat,
    tools?: Tool[],
  ): Promise<string | Record<string, unknown>> {
    const completion = await this.openai.chat.completions.create({
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
