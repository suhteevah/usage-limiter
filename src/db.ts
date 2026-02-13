/**
 * SQLite database layer for usage tracking.
 * Uses better-sqlite3 for synchronous, durable persistence.
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export type UsageRecord = {
  timestamp: number;
  sessionKey?: string;
  provider?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
};

export type PeriodUsageSummary = {
  totalTokens: number;
  totalCost: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type UsageHistoryEntry = {
  date: string; // YYYY-MM-DD
  totalTokens: number;
  totalCost: number;
  requestCount: number;
};

export type ModelUsageEntry = {
  provider: string;
  model: string;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
};

export type LimitOverride = {
  period: string;
  limitType: string;
  limitValue: number;
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  session_key TEXT,
  provider TEXT,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  duration_ms INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(provider, model);

CREATE TABLE IF NOT EXISTS limits_override (
  period TEXT NOT NULL,
  limit_type TEXT NOT NULL,
  limit_value REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(period, limit_type)
);

CREATE TABLE IF NOT EXISTS manual_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  reset_at INTEGER NOT NULL
);
`;

export function initDatabase(stateDir: string): Database.Database {
  const pluginDir = join(stateDir, "plugins", "usage-limiter");
  mkdirSync(pluginDir, { recursive: true });

  const dbPath = join(pluginDir, "usage.db");
  const db = new Database(dbPath);

  // Performance settings
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  // Run schema
  db.exec(SCHEMA_SQL);

  return db;
}

// ── Record insertion ────────────────────────────────────────────────

const INSERT_USAGE_SQL = `
  INSERT INTO usage_records (
    timestamp, session_key, provider, model,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    total_tokens, cost_usd, duration_ms
  ) VALUES (
    @timestamp, @sessionKey, @provider, @model,
    @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens,
    @totalTokens, @costUsd, @durationMs
  )
`;

export function recordUsage(db: Database.Database, record: UsageRecord): void {
  const stmt = db.prepare(INSERT_USAGE_SQL);
  stmt.run({
    timestamp: record.timestamp,
    sessionKey: record.sessionKey ?? null,
    provider: record.provider ?? null,
    model: record.model ?? null,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    totalTokens: record.totalTokens,
    costUsd: record.costUsd,
    durationMs: record.durationMs,
  });
}

// ── Period aggregation queries ──────────────────────────────────────

export function queryPeriodUsage(
  db: Database.Database,
  periodStart: number
): PeriodUsageSummary {
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(total_tokens), 0)      AS totalTokens,
        COALESCE(SUM(cost_usd), 0)          AS totalCost,
        COUNT(*)                              AS requestCount,
        COALESCE(SUM(input_tokens), 0)       AS inputTokens,
        COALESCE(SUM(output_tokens), 0)      AS outputTokens,
        COALESCE(SUM(cache_read_tokens), 0)  AS cacheReadTokens,
        COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens
      FROM usage_records
      WHERE timestamp >= ?`
    )
    .get(periodStart) as PeriodUsageSummary | undefined;

  return row ?? {
    totalTokens: 0,
    totalCost: 0,
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

// ── Usage history (for charts) ──────────────────────────────────────

export function queryUsageHistory(
  db: Database.Database,
  fromTs: number,
  toTs: number
): UsageHistoryEntry[] {
  return db
    .prepare(
      `SELECT
        date(timestamp / 1000, 'unixepoch') AS date,
        COALESCE(SUM(total_tokens), 0)      AS totalTokens,
        COALESCE(SUM(cost_usd), 0)          AS totalCost,
        COUNT(*)                              AS requestCount
      FROM usage_records
      WHERE timestamp >= ? AND timestamp < ?
      GROUP BY date
      ORDER BY date ASC`
    )
    .all(fromTs, toTs) as UsageHistoryEntry[];
}

// ── Model breakdown ─────────────────────────────────────────────────

export function queryModelUsage(
  db: Database.Database,
  periodStart: number
): ModelUsageEntry[] {
  return db
    .prepare(
      `SELECT
        COALESCE(provider, 'unknown') AS provider,
        COALESCE(model, 'unknown')    AS model,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(cost_usd), 0)     AS totalCost,
        COUNT(*)                        AS requestCount
      FROM usage_records
      WHERE timestamp >= ?
      GROUP BY provider, model
      ORDER BY totalCost DESC`
    )
    .all(periodStart) as ModelUsageEntry[];
}

// ── Limit overrides ─────────────────────────────────────────────────

export function getOverrideLimits(db: Database.Database): LimitOverride[] {
  return db
    .prepare(`SELECT period, limit_type AS limitType, limit_value AS limitValue FROM limits_override`)
    .all() as LimitOverride[];
}

export function setOverrideLimit(
  db: Database.Database,
  period: string,
  limitType: string,
  limitValue: number
): void {
  db.prepare(
    `INSERT INTO limits_override (period, limit_type, limit_value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(period, limit_type) DO UPDATE SET
       limit_value = excluded.limit_value,
       updated_at = excluded.updated_at`
  ).run(period, limitType, limitValue, Date.now());
}

export function removeOverrideLimit(
  db: Database.Database,
  period: string,
  limitType: string
): void {
  db.prepare(`DELETE FROM limits_override WHERE period = ? AND limit_type = ?`)
    .run(period, limitType);
}

// ── Manual resets ───────────────────────────────────────────────────

export function recordReset(db: Database.Database, period: string): void {
  db.prepare(`INSERT INTO manual_resets (period, reset_at) VALUES (?, ?)`)
    .run(period, Date.now());
}

export function getLatestReset(
  db: Database.Database,
  period: string
): number | null {
  const row = db
    .prepare(
      `SELECT MAX(reset_at) AS resetAt FROM manual_resets WHERE period = ? OR period = 'all'`
    )
    .get(period) as { resetAt: number | null } | undefined;

  return row?.resetAt ?? null;
}

// ── Maintenance ─────────────────────────────────────────────────────

/**
 * Clean up old records beyond the retention window.
 * Default: 90 days.
 */
export function pruneOldRecords(db: Database.Database, retentionDays: number = 90): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db.prepare(`DELETE FROM usage_records WHERE timestamp < ?`).run(cutoff);
  return result.changes;
}
