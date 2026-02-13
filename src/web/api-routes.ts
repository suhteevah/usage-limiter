/**
 * JSON API routes for the web dashboard.
 * These serve data that the dashboard HTML fetches via JavaScript.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type Database from "better-sqlite3";
import type { PluginConfig } from "../config.js";
import { checkAllBudgets, getPeriodSummary } from "../limits.js";
import { ALL_PERIODS, getPeriodStart } from "../periods.js";
import {
  queryUsageHistory,
  queryModelUsage,
  getOverrideLimits,
  setOverrideLimit,
  removeOverrideLimit,
  recordReset,
} from "../db.js";

function jsonResponse(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

export function createSummaryApiHandler(db: Database.Database, config: PluginConfig) {
  return async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
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

      jsonResponse(res, {
        statuses,
        summaries,
        config: {
          warnThreshold: config.warnThreshold,
          blockThreshold: config.blockThreshold,
          fallbackModel: config.fallbackModel,
          autoDowngrade: config.autoDowngrade,
          timezone: config.timezone,
        },
      });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
  };
}

export function createHistoryApiHandler(db: Database.Database, config: PluginConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const days = parseInt(url.searchParams.get("days") ?? "30", 10);
      const now = Date.now();
      const fromTs = now - days * 24 * 60 * 60 * 1000;

      const history = queryUsageHistory(db, fromTs, now);
      const todayStart = getPeriodStart("daily", config.timezone);
      const models = queryModelUsage(db, todayStart);

      jsonResponse(res, { history, models });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
  };
}

export function createLimitsApiHandler(db: Database.Database, _config: PluginConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method === "POST") {
        const body = await parseBody(req);
        const action = body.action as string;

        if (action === "set") {
          const period = body.period as string;
          const limitType = body.limitType as string;
          const value = body.value as number;

          if (!period || !limitType || typeof value !== "number") {
            jsonResponse(res, { error: "Required: period, limitType, value" }, 400);
            return;
          }
          setOverrideLimit(db, period, limitType, value);
          jsonResponse(res, { ok: true });
          return;
        }

        if (action === "remove") {
          const period = body.period as string;
          const limitType = body.limitType as string;
          removeOverrideLimit(db, period, limitType);
          jsonResponse(res, { ok: true });
          return;
        }

        if (action === "reset") {
          const period = (body.period as string) ?? "all";
          recordReset(db, period);
          jsonResponse(res, { ok: true });
          return;
        }

        jsonResponse(res, { error: "Unknown action" }, 400);
        return;
      }

      // GET: list overrides
      const overrides = getOverrideLimits(db);
      jsonResponse(res, { overrides });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
  };
}
