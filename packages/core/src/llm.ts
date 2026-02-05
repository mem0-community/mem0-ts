export interface Message {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface LLMConfig {
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  [key: string]: unknown;
}

export interface LLMResponseFormat {
  type: "json_object" | "text";
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export abstract class LLM {
  protected config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  abstract generateResponse(
    messages: Message[],
    responseFormat?: LLMResponseFormat,
    tools?: Tool[],
  ): Promise<string | Record<string, unknown>>;
}
