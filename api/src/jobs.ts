import { db } from "./db.ts";

// A small job queue, stored in Postgres. Work that doesn't need to finish before the user gets an
// answer (like sending an email) is saved as a job, and a worker runs it afterwards, retrying
// failures with growing gaps.

export type JobHandlers = Record<string, (payload: unknown) => Promise<void>>;

export const MAX_ATTEMPTS = 5;

// 30 seconds, then 1, 2, 4 minutes...: each retry waits twice as long as the last.
export const retryDelaySeconds = (attempts: number) => 30 * 2 ** attempts;

// Runs one job that's due, if there is one. Returns false when there's nothing to do.
export async function runNextJob(handlers: JobHandlers): Promise<boolean> {
  return db.transaction(async (tx) => {
    // SKIP LOCKED: if another worker has already claimed a job, skip it instead of waiting.
    const result = await tx.query<{ id: number; kind: string; payload: unknown; attempts: number }>(
      `SELECT id, kind, payload, attempts FROM jobs
       WHERE run_after <= now() AND attempts < $1
       ORDER BY id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS],
    );
    const job = result.rows[0];
    if (!job) return false;

    try {
      const handler = handlers[job.kind];
      if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
      await handler(job.payload);
      await tx.query("DELETE FROM jobs WHERE id = $1", [job.id]);
    } catch (err) {
      await tx.query(
        `UPDATE jobs SET attempts = attempts + 1, last_error = $2, run_after = now() + $3 * interval '1 second'
         WHERE id = $1`,
        [job.id, (err as Error).message, retryDelaySeconds(job.attempts)],
      );
      console.error(JSON.stringify({ job: job.id, kind: job.kind, attempt: job.attempts + 1, error: (err as Error).message }));
    }
    return true;
  });
}

// Keeps running jobs until the queue is empty, then checks again every few seconds.
export function startWorker(handlers: JobHandlers, idleMs = 2000): () => void {
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      const worked = await runNextJob(handlers).catch((err) => {
        console.error("Worker error:", err);
        return false;
      });
      if (!worked) await new Promise((resolve) => setTimeout(resolve, idleMs));
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
