import {
  LLM,
  type LLMConfig,
  type LLMResponseFormat,
  type Message,
  type Tool,
} from "@mem0-community/core";
import Anthropic from "@anthropic-ai/sdk";

export interface AnthropicLLMConfig extends LLMConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export class AnthropicLLM extends LLM {
  private client: Anthropic;
  private model: string;

  constructor(config: AnthropicLLMConfig) {
    super(config);
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL && { baseURL: config.baseURL }),
    });
    this.model = config.model ?? "claude-sonnet-4-20250514";
  }

  async generateResponse(
    messages: Message[],
    _responseFormat?: LLMResponseFormat,
    tools?: Tool[],
  ): Promise<string | Record<string, unknown>> {
    const systemMessage = messages.find((msg) => msg.role === "system");
    const nonSystemMessages = messages.filter((msg) => msg.role !== "system");

    const anthropicMessages = nonSystemMessages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content:
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      ...(systemMessage && {
        system:
          typeof systemMessage.content === "string"
            ? systemMessage.content
            : JSON.stringify(systemMessage.content),
      }),
      messages: anthropicMessages,
      ...(tools && {
        tools: tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          input_schema: tool.function
            .parameters as Anthropic.Messages.Tool.InputSchema,
        })),
      }),
    });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === "tool_use",
    );

    if (toolUseBlocks.length > 0) {
      const textBlock = response.content.find(
        (block): block is Anthropic.Messages.TextBlock => block.type === "text",
      );
      return {
        content: textBlock?.text ?? "",
        role: "assistant",
        toolCalls: toolUseBlocks.map((block) => ({
          name: block.name,
          arguments: JSON.stringify(block.input),
        })),
      };
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text",
    );

    return textBlock?.text ?? "";
  }
}
