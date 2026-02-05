export interface HistoryManager {
  addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: string,
    createdAt?: string,
    updatedAt?: string,
    isDeleted?: number,
  ): Promise<void>;
  getHistory(memoryId: string): Promise<HistoryEntry[]>;
  reset(): Promise<void>;
  close(): void;
}

export interface HistoryEntry {
  id: string;
  memoryId: string;
  previousValue: string | null;
  newValue: string | null;
  action: string;
  createdAt: string;
  updatedAt: string | null;
  isDeleted: number;
}

/**
 * No-op history manager. Used when history tracking is disabled.
 */
export class NoopHistoryManager implements HistoryManager {
  async addHistory(): Promise<void> {}
  async getHistory(): Promise<HistoryEntry[]> {
    return [];
  }
  async reset(): Promise<void> {}
  close(): void {}
}

/**
 * In-memory history manager. Useful for testing or short-lived sessions.
 */
export class InMemoryHistoryManager implements HistoryManager {
  private store = new Map<string, HistoryEntry[]>();

  async addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: string,
    createdAt?: string,
    updatedAt?: string,
    isDeleted = 0,
  ): Promise<void> {
    const entries = this.store.get(memoryId) ?? [];
    entries.push({
      id:
        globalThis.crypto?.randomUUID?.() ??
        Math.random().toString(36).slice(2),
      memoryId,
      previousValue,
      newValue,
      action,
      createdAt: createdAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? null,
      isDeleted,
    });
    this.store.set(memoryId, entries);
  }

  async getHistory(memoryId: string): Promise<HistoryEntry[]> {
    return (this.store.get(memoryId) ?? [])
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 100);
  }

  async reset(): Promise<void> {
    this.store.clear();
  }

  close(): void {}
}
