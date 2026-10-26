// Counts requests and how long they take, in the plain-text format monitoring tools understand
// (Prometheus's). Kept in memory, so each server process counts its own requests.

const BUCKETS_MS = [10, 50, 100, 250, 500, 1000, 2500];

export class Metrics {
  requests = new Map<string, number>();
  durations = new Map<string, { buckets: number[]; sum: number; count: number }>();

  // route is the pattern ("/orders/:id"), not the real path ("/orders/7"), so there's one line per
  // route rather than one per order.
  record(method: string, route: string, status: number, ms: number): void {
    const key = `method="${method}",route="${route}",status="${status}"`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    const timing = this.durations.get(route) ?? { buckets: BUCKETS_MS.map(() => 0), sum: 0, count: 0 };
    BUCKETS_MS.forEach((limit, i) => {
      if (ms <= limit) timing.buckets[i]++;
    });
    timing.sum += ms;
    timing.count++;
    this.durations.set(route, timing);
  }

  text(): string {
    const lines = ["# TYPE http_requests_total counter"];
    for (const [labels, count] of this.requests) lines.push(`http_requests_total{${labels}} ${count}`);
    lines.push("# TYPE http_request_duration_ms histogram");
    for (const [route, t] of this.durations) {
      BUCKETS_MS.forEach((limit, i) => lines.push(`http_request_duration_ms_bucket{route="${route}",le="${limit}"} ${t.buckets[i]}`));
      lines.push(`http_request_duration_ms_bucket{route="${route}",le="+Inf"} ${t.count}`);
      lines.push(`http_request_duration_ms_sum{route="${route}"} ${t.sum}`);
      lines.push(`http_request_duration_ms_count{route="${route}"} ${t.count}`);
    }
    return lines.join("\n") + "\n";
  }
}
