import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryHistoryManager, NoopHistoryManager } from "../history";

describe("NoopHistoryManager", () => {
  const noop = new NoopHistoryManager();

  it("addHistory does nothing", async () => {
    await expect(
      noop.addHistory("m1", null, "hello", "ADD"),
    ).resolves.toBeUndefined();
  });

  it("getHistory returns empty array", async () => {
    await noop.addHistory("m1", null, "hello", "ADD");
    const history = await noop.getHistory("m1");
    expect(history).toEqual([]);
  });

  it("reset does nothing", async () => {
    await expect(noop.reset()).resolves.toBeUndefined();
  });
});

describe("InMemoryHistoryManager", () => {
  let manager: InMemoryHistoryManager;

  beforeEach(() => {
    manager = new InMemoryHistoryManager();
  });

  it("stores and retrieves history", async () => {
    await manager.addHistory("m1", null, "first value", "ADD");
    const history = await manager.getHistory("m1");

    expect(history).toHaveLength(1);
    expect(history[0]!.memoryId).toBe("m1");
    expect(history[0]!.previousValue).toBeNull();
    expect(history[0]!.newValue).toBe("first value");
    expect(history[0]!.action).toBe("ADD");
  });

  it("tracks updates with previous value", async () => {
    await manager.addHistory(
      "m1",
      null,
      "original",
      "ADD",
      "2024-01-01T00:00:00Z",
    );
    await manager.addHistory(
      "m1",
      "original",
      "updated",
      "UPDATE",
      "2024-01-01T00:01:00Z",
    );

    const history = await manager.getHistory("m1");
    expect(history).toHaveLength(2);
    // Sorted by createdAt descending — most recent first
    expect(history[0]!.action).toBe("UPDATE");
    expect(history[0]!.previousValue).toBe("original");
    expect(history[0]!.newValue).toBe("updated");
  });

  it("isolates history by memoryId", async () => {
    await manager.addHistory("m1", null, "memory one", "ADD");
    await manager.addHistory("m2", null, "memory two", "ADD");

    expect(await manager.getHistory("m1")).toHaveLength(1);
    expect(await manager.getHistory("m2")).toHaveLength(1);
    expect(await manager.getHistory("m3")).toHaveLength(0);
  });

  it("reset clears all history", async () => {
    await manager.addHistory("m1", null, "value", "ADD");
    await manager.addHistory("m2", null, "value", "ADD");
    await manager.reset();

    expect(await manager.getHistory("m1")).toHaveLength(0);
    expect(await manager.getHistory("m2")).toHaveLength(0);
  });

  it("records isDeleted flag", async () => {
    await manager.addHistory(
      "m1",
      "old",
      null,
      "DELETE",
      undefined,
      undefined,
      1,
    );
    const history = await manager.getHistory("m1");
    expect(history[0]!.isDeleted).toBe(1);
  });
});
