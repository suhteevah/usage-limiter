/**
 * Budget limit checking logic.
 * Queries SQLite for period aggregates and compares against configured limits.
 */

import type Database from "better-sqlite3";
import {
  queryPeriodUsage,
  getOverrideLimits,
  getLatestReset,
  type PeriodUsageSummary,
} from "./db.js";
import { getPeriodStart, ALL_PERIODS, type Period } from "./periods.js";
import type { PluginConfig } from "./config.js";

export type LimitType = "tokens" | "cost" | "requests";

export type BudgetStatus = {
  period: Period;
  limitType: LimitType;
  current: number;
  limit: number;
  ratio: number;
  status: "ok" | "warn" | "blocked";
};

export type OverallStatus = "ok" | "warn" | "blocked";

/**
 * Check all configured budgets across all periods.
 * Returns a status entry for each active limit.
 */
export function checkAllBudgets(
  db: Database.Database,
  config: PluginConfig
): BudgetStatus[] {
  const statuses: BudgetStatus[] = [];
  const overrides = getOverrideLimits(db);

  for (const period of ALL_PERIODS) {
    const periodLimits = config.limits?.[period];
    if (!periodLimits) continue;

    // Compute effective period start, accounting for manual resets
    let periodStart = getPeriodStart(period, config.timezone);
    const lastReset = getLatestReset(db, period);
    if (lastReset !== null && lastReset > periodStart) {
      periodStart = lastReset;
    }

    const usage = queryPeriodUsage(db, periodStart);

    // Check each limit type
    const limitTypes: Array<{ type: LimitType; current: number }> = [
      { type: "tokens", current: usage.totalTokens },
      { type: "cost", current: usage.totalCost },
      { type: "requests", current: usage.requestCount },
    ];

    for (const { type, current } of limitTypes) {
      // Resolve effective limit: override > config
      let limit = periodLimits[type];
      const override = overrides.find(
        (o) => o.period === period && o.limitType === type
      );
      if (override) {
        limit = override.limitValue;
      }

      if (limit === undefined || limit <= 0) continue;

      const ratio = current / limit;
      let status: "ok" | "warn" | "blocked";

      if (ratio >= config.blockThreshold) {
        status = "blocked";
      } else if (ratio >= config.warnThreshold) {
        status = "warn";
      } else {
        status = "ok";
      }

      statuses.push({ period, limitType: type, current, limit, ratio, status });
    }
  }

  return statuses;
}

/**
 * Get the worst (most restrictive) status across all budgets.
 */
export function getWorstStatus(statuses: BudgetStatus[]): OverallStatus {
  if (statuses.some((s) => s.status === "blocked")) return "blocked";
  if (statuses.some((s) => s.status === "warn")) return "warn";
  return "ok";
}

/**
 * Get usage summary for a specific period.
 */
export function getPeriodSummary(
  db: Database.Database,
  period: Period,
  config: PluginConfig
): PeriodUsageSummary {
  let periodStart = getPeriodStart(period, config.timezone);
  const lastReset = getLatestReset(db, period);
  if (lastReset !== null && lastReset > periodStart) {
    periodStart = lastReset;
  }
  return queryPeriodUsage(db, periodStart);
}

// ── Formatting utilities ────────────────────────────────────────────

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}

export function formatUsd(amount: number): string {
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.01) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(4)}`;
}

export function formatLimitValue(type: LimitType, value: number): string {
  switch (type) {
    case "tokens":
      return formatTokenCount(value);
    case "cost":
      return formatUsd(value);
    case "requests":
      return `${value}`;
  }
}

export function formatProgressBar(ratio: number, width: number = 10): string {
  const filled = Math.min(Math.round(ratio * width), width);
  const empty = width - filled;
  return "[" + "=".repeat(filled) + "-".repeat(empty) + "]";
}

export function statusEmoji(status: "ok" | "warn" | "blocked"): string {
  switch (status) {
    case "ok":
      return "OK";
    case "warn":
      return "WARN";
    case "blocked":
      return "BLOCKED";
  }
}
