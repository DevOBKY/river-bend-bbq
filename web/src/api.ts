export type MenuItem = { id: number; name: string; category: string; price_cents: number };
export type CartLine = { item: MenuItem; quantity: number };
export type Order = {
  id: number;
  customer: string;
  pickup_at: string;
  status: string;
  items: { item: string; quantity: number; line_cents: number }[];
  total_cents: number;
};

// An error the API sent back on purpose, like a 400 or 401, with its message.
export class ApiError extends Error {
  status: number;
  issues: string[];
  constructor(status: number, message: string, issues: string[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

export async function api<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options?.method ?? 'GET',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`, data.issues);
  return data as T;
}

export const formatDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
