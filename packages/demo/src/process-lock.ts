import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A lifetime-held SQLite write lock: the OS releases it even after SIGKILL.
 * Never unlink this file. Replacing a locked inode would permit two owners.
 * Separate databases protect the dashboard manager and its signing worker.
 */
export function acquireProcessLock(path: string, owner: string): () => void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true });
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec(
      "CREATE TABLE IF NOT EXISTS process_owner (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, pid INTEGER NOT NULL)",
    );
    db.exec("BEGIN EXCLUSIVE");
    db.query(
      "INSERT OR REPLACE INTO process_owner (id, owner, pid) VALUES (1, ?, ?)",
    ).run(owner, process.pid);
  } catch (error) {
    db.close(true);
    const code = (error as { code?: string }).code;
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
      throw new Error(
        `Another process owns the ${owner} execution lock. Let that process finish before starting another run.`,
      );
    }
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      db.exec("COMMIT");
    } finally {
      db.close(true);
    }
  };
}
