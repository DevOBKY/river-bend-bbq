// A small in-memory cache: remembers a value for a while, so the database isn't asked the same
// question on every request. Each server process has its own copy (S1, lesson 4).
export class TtlCache<T> {
  ttlMs: number;
  now: () => number;
  entries = new Map<string, { value: T; expires: number }>();

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    const value = await load();
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    return value;
  }

  // Call this whenever the source of truth changes, so nobody sees the old value until it expires.
  clear(): void {
    this.entries.clear();
  }
}
