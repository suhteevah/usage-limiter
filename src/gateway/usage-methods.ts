/**
 * Gateway RPC methods for the web dashboard.
 * Registered via api.registerGatewayMethod().
 */

import type Database from "better-sqlite3";
import type { PluginConfig } from "../config.js";
import {
  checkAllBudgets,
  getPeriodSummary,
} from "../limits.js";
import { ALL_PERIODS, getPeriodStart, type Period } from "../periods.js";
import {
  queryUsageHistory,
  queryModelUsage,
  getOverrideLimits,
  setOverrideLimit,
  removeOverrideLimit,
  recordReset,
} from "../db.js";

type GatewayHandlerOpts = {
  req: unknown;
  params: Record<string, unknown>;
  client: unknown;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
  context: unknown;
};

/**
 * usage-limiter.summary: Returns current budget status for all periods.
 */
export function createSummaryMethod(db: Database.Database, config: PluginConfig) {
  return (opts: GatewayHandlerOpts): void => {
    try {
      const statuses = checkAllBudgets(db, config);
      const summaries: Record<string, unknown> = {};

      for (const period of ALL_PERIODS) {
        const summary = getPeriodSummary(db, period, config);
        const periodStatuses = statuses.filter((s) => s.period === period);
        summaries[period] = {
          usage: summary,
          limits: periodStatuses.map((s) => ({
            type: s.limitType,
            current: s.current,
            limit: s.limit,
            ratio: s.ratio,
            status: s.status,
          })),
        };
      }

      opts.respond(true, {
        statuses,
        summaries,
        config: {
          warnThreshold: config.warnThreshold,
          blockThreshold: config.blockThreshold,
          fallbackModel: config.fallbackModel,
          autoDowngrade: config.autoDowngrade,
        },
      });
    } catch (err) {
      opts.respond(false, undefined, {
        code: "INTERNAL_ERROR",
        message: String(err),
      });
    }
  };
}

/**
 * usage-limiter.history: Returns daily usage history for charts.
 */
export function createHistoryMethod(db: Database.Database, config: PluginConfig) {
  return (opts: GatewayHandlerOpts): void => {
    try {
      const days = typeof opts.params.days === "number" ? opts.params.days : 30;
      const now = Date.now();
      const fromTs = now - days * 24 * 60 * 60 * 1000;
      const history = queryUsageHistory(db, fromTs, now);

      // Also get model breakdown for today
      const todayStart = getPeriodStart("daily", config.timezone);
      const models = queryModelUsage(db, todayStart);

      opts.respond(true, { history, models });
    } catch (err) {
      opts.respond(false, undefined, {
        code: "INTERNAL_ERROR",
        message: String(err),
      });
    }
  };
}

/**
 * usage-limiter.limits: Get/set limit overrides.
 */
export function createLimitsMethod(db: Database.Database, _config: PluginConfig) {
  return (opts: GatewayHandlerOpts): void => {
    try {
      const action = opts.params.action as string | undefined;

      if (action === "set") {
        const period = opts.params.period as string;
        const limitType = opts.params.limitType as string;
        const value = opts.params.value as number;

        if (!period || !limitType || typeof value !== "number") {
          opts.respond(false, undefined, {
            code: "INVALID_PARAMS",
            message: "Required: period, limitType, value",
          });
          return;
        }

        setOverrideLimit(db, period, limitType, value);
        opts.respond(true, { ok: true });
        return;
      }

      if (action === "remove") {
        const period = opts.params.period as string;
        const limitType = opts.params.limitType as string;

        if (!period || !limitType) {
          opts.respond(false, undefined, {
            code: "INVALID_PARAMS",
            message: "Required: period, limitType",
          });
          return;
        }

        removeOverrideLimit(db, period, limitType);
        opts.respond(true, { ok: true });
        return;
      }

      if (action === "reset") {
        const period = (opts.params.period as string) ?? "all";
        recordReset(db, period);
        opts.respond(true, { ok: true });
        return;
      }

      // Default: list current overrides
      const overrides = getOverrideLimits(db);
      opts.respond(true, { overrides });
    } catch (err) {
      opts.respond(false, undefined, {
        code: "INTERNAL_ERROR",
        message: String(err),
      });
    }
  };
}
