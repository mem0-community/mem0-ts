import {
  LLM,
  type LLMConfig,
  type LLMResponseFormat,
  type Message,
  type Tool,
} from "@mem0-community/core";
import { GoogleGenAI } from "@google/genai";

export interface GoogleLLMConfig extends LLMConfig {
  apiKey: string;
  model?: string;
}

export class GoogleLLM extends LLM {
  private google: GoogleGenAI;
  private model: string;

  constructor(config: GoogleLLMConfig) {
    super(config);
    this.google = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model ?? "gemini-2.0-flash";
  }

  async generateResponse(
    messages: Message[],
    _responseFormat?: LLMResponseFormat,
    _tools?: Tool[],
  ): Promise<string | Record<string, unknown>> {
    const completion = await this.google.models.generateContent({
      contents: messages.map((msg) => ({
        parts: [
          {
            text:
              typeof msg.content === "string"
                ? msg.content
                : JSON.stringify(msg.content),
          },
        ],
        role: msg.role === "system" ? "model" : "user",
      })),
      model: this.model,
    });

    const text = completion.text
      ?.replace(/^```json\n/, "")
      .replace(/\n```$/, "");

    return text || "";
  }
}
