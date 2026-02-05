import { describe, it, expect } from "vitest";
import {
  getFactRetrievalMessages,
  getUpdateMemoryMessages,
  removeCodeBlocks,
} from "../prompts";

describe("removeCodeBlocks", () => {
  it("strips ```json fences", () => {
    const input = '```json\n{"facts":["hello"]}\n```';
    expect(removeCodeBlocks(input)).toBe('{"facts":["hello"]}');
  });

  it("strips bare ``` fences", () => {
    const input = '```\n{"key":"value"}\n```';
    expect(removeCodeBlocks(input)).toBe('{"key":"value"}');
  });

  it("returns clean JSON unchanged", () => {
    const input = '{"facts":[]}';
    expect(removeCodeBlocks(input)).toBe('{"facts":[]}');
  });

  it("trims whitespace", () => {
    const input = '  \n{"facts":[]}\n  ';
    expect(removeCodeBlocks(input)).toBe('{"facts":[]}');
  });
});

describe("getFactRetrievalMessages", () => {
  it("returns [systemPrompt, userPrompt] tuple", () => {
    const [system, user] = getFactRetrievalMessages("Hi, my name is Alice");
    expect(typeof system).toBe("string");
    expect(typeof user).toBe("string");
  });

  it("system prompt contains date", () => {
    const [system] = getFactRetrievalMessages("test");
    const today = new Date().toISOString().split("T")[0]!;
    expect(system).toContain(today);
  });

  it("system prompt contains language detection instruction", () => {
    const [system] = getFactRetrievalMessages("test");
    expect(system).toContain("detect the language");
  });

  it("system prompt contains codeblock warning", () => {
    const [system] = getFactRetrievalMessages("test");
    expect(system).toContain("DO NOT ADD ANY ADDITIONAL TEXT OR CODEBLOCK");
  });

  it("user prompt contains the input", () => {
    const [, user] = getFactRetrievalMessages("I love TypeScript");
    expect(user).toContain("I love TypeScript");
  });
});

describe("getUpdateMemoryMessages", () => {
  it("includes existing memories in the prompt", () => {
    const prompt = getUpdateMemoryMessages(
      [{ id: "0", text: "Name is Alice" }],
      ["Loves TypeScript"],
    );
    expect(prompt).toContain("Name is Alice");
    expect(prompt).toContain("Loves TypeScript");
  });

  it("handles empty memories", () => {
    const prompt = getUpdateMemoryMessages([], ["New fact"]);
    expect(prompt).toContain("[]");
    expect(prompt).toContain("New fact");
  });

  it("contains all four operation instructions", () => {
    const prompt = getUpdateMemoryMessages([], []);
    expect(prompt).toContain('"ADD"');
    expect(prompt).toContain('"UPDATE"');
    expect(prompt).toContain('"DELETE"');
    expect(prompt).toContain('"NONE"');
  });
});
