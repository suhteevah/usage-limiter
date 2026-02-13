/**
 * Usage Limiter - OpenClaw Plugin
 *
 * Enforces token, cost, and request limits with:
 * - Warning at configurable threshold (default 80%) with model downgrade offer
 * - Hard block at configurable threshold (default 100%)
 * - SQLite-backed persistence
 * - Web dashboard, chat command, and CLI
 */

import { initDatabase, recordUsage, type UsageRecord } from "./db.js";
import { resolvePluginConfig } from "./config.js";
import { createBeforeAgentStartHook } from "./hooks/before-agent-start.js";
import { createMessageSendingHook } from "./hooks/message-sending.js";
import { createAgentEndHook, markTimestampRecorded } from "./hooks/agent-end.js";
import { createUsageCommand } from "./commands/usage-command.js";
import { createUsageCli } from "./cli/usage-cli.js";
import {
  createSummaryMethod,
  createHistoryMethod,
  createLimitsMethod,
} from "./gateway/usage-methods.js";
import { createDashboardHandler } from "./web/dashboard.js";
import {
  createSummaryApiHandler,
  createHistoryApiHandler,
  createLimitsApiHandler,
} from "./web/api-routes.js";

// Plugin types - using structural typing to avoid hard import dependency
type PluginApi = {
  id: string;
  name: string;
  config: unknown;
  pluginConfig?: Record<string, unknown>;
  runtime: {
    state: {
      resolveStateDir: (config: unknown) => string;
    };
  };
  logger: {
    debug?: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  on: (hookName: string, handler: (...args: unknown[]) => unknown, opts?: { priority?: number }) => void;
  registerService: (service: {
    id: string;
    start: (ctx: { config: unknown; stateDir: string; logger: unknown }) => void | Promise<void>;
    stop?: (ctx: { config: unknown; stateDir: string; logger: unknown }) => void | Promise<void>;
  }) => void;
  registerCommand: (command: unknown) => void;
  registerCli: (registrar: (ctx: unknown) => void | Promise<void>, opts?: { commands?: string[] }) => void;
  registerGatewayMethod: (method: string, handler: (opts: unknown) => void | Promise<void>) => void;
  registerHttpRoute: (params: { path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }) => void;
};

// Diagnostic event types
type DiagnosticUsageEvent = {
  type: "model.usage";
  ts: number;
  seq: number;
  sessionKey?: string;
  sessionId?: string;
  channel?: string;
  provider?: string;
  model?: string;
  usage: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  costUsd?: number;
  durationMs?: number;
};

type DiagnosticEvent = DiagnosticUsageEvent | { type: string; [key: string]: unknown };

const plugin = {
  id: "usage-limiter",
  name: "Usage Limiter",
  description: "Enforce token, cost, and request limits to control model usage costs",
  version: "1.0.0",

  register(api: PluginApi) {
    const config = resolvePluginConfig(api.pluginConfig);
    const stateDir = api.runtime.state.resolveStateDir(api.config);
    const db = initDatabase(stateDir);
    const logger = api.logger;

    logger.info(
      `[usage-limiter] Initialized. Warn: ${config.warnThreshold * 100}%, Block: ${config.blockThreshold * 100}%, Fallback: ${config.fallbackModel ?? "none"}`
    );

    // ── Lifecycle Hooks ───────────────────────────────────────────
    api.on(
      "before_agent_start",
      createBeforeAgentStartHook(db, config, logger) as (...args: unknown[]) => unknown,
      { priority: 100 }
    );

    api.on(
      "message_sending",
      createMessageSendingHook(db, config, logger) as (...args: unknown[]) => unknown,
      { priority: 100 }
    );

    api.on(
      "agent_end",
      createAgentEndHook(db, config, logger) as (...args: unknown[]) => unknown
    );

    // ── Usage Tracking Service ────────────────────────────────────
    api.registerService({
      id: "usage-limiter-tracker",
      start: async (ctx) => {
        // Try to import onDiagnosticEvent from the plugin SDK
        try {
          const sdk = await import("openclaw/plugin-sdk");
          const onDiagnosticEvent = (sdk as Record<string, unknown>).onDiagnosticEvent as
            | ((listener: (evt: DiagnosticEvent) => void) => () => void)
            | undefined;

          if (typeof onDiagnosticEvent === "function") {
            const unsubscribe = onDiagnosticEvent((evt: DiagnosticEvent) => {
              if (evt.type !== "model.usage") return;

              const usageEvt = evt as DiagnosticUsageEvent;
              const usage = usageEvt.usage ?? {};
              const totalTokens =
                (usage.total ?? 0) ||
                (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);

              const record: UsageRecord = {
                timestamp: usageEvt.ts ?? Date.now(),
                sessionKey: usageEvt.sessionKey,
                provider: usageEvt.provider,
                model: usageEvt.model,
                inputTokens: usage.input ?? 0,
                outputTokens: usage.output ?? 0,
                cacheReadTokens: usage.cacheRead ?? 0,
                cacheWriteTokens: usage.cacheWrite ?? 0,
                totalTokens,
                costUsd: usageEvt.costUsd ?? 0,
                durationMs: usageEvt.durationMs ?? 0,
              };

              recordUsage(db, record);
              markTimestampRecorded(record.timestamp);

              logger.info(
                `[usage-limiter] Recorded: ${record.totalTokens} tokens, ${record.costUsd.toFixed(4)} USD (${record.provider}/${record.model})`
              );
            });

            // Store unsubscribe for cleanup
            (ctx as Record<string, unknown>)._unsubscribe = unsubscribe;
            logger.info("[usage-limiter] Diagnostic event listener active.");
          } else {
            logger.warn(
              "[usage-limiter] onDiagnosticEvent not available. Using agent_end fallback only."
            );
          }
        } catch {
          logger.warn(
            "[usage-limiter] Could not import openclaw/plugin-sdk. Using agent_end fallback only."
          );
        }
      },
      stop: (ctx) => {
        const unsubscribe = (ctx as Record<string, unknown>)._unsubscribe as (() => void) | undefined;
        if (typeof unsubscribe === "function") {
          unsubscribe();
          logger.info("[usage-limiter] Diagnostic event listener stopped.");
        }
      },
    });

    // ── Chat Command ──────────────────────────────────────────────
    api.registerCommand(createUsageCommand(db, config) as unknown);

    // ── CLI Commands ──────────────────────────────────────────────
    api.registerCli(
      createUsageCli(db, config) as (ctx: unknown) => void,
      { commands: ["usage-limiter"] }
    );

    // ── Gateway RPC Methods ───────────────────────────────────────
    api.registerGatewayMethod(
      "usage-limiter.summary",
      createSummaryMethod(db, config) as (opts: unknown) => void
    );
    api.registerGatewayMethod(
      "usage-limiter.history",
      createHistoryMethod(db, config) as (opts: unknown) => void
    );
    api.registerGatewayMethod(
      "usage-limiter.limits",
      createLimitsMethod(db, config) as (opts: unknown) => void
    );

    // ── Web Dashboard ─────────────────────────────────────────────
    if (config.dashboardEnabled) {
      api.registerHttpRoute({
        path: "/plugins/usage-limiter/dashboard",
        handler: createDashboardHandler() as (req: unknown, res: unknown) => void,
      });
      api.registerHttpRoute({
        path: "/plugins/usage-limiter/api/summary",
        handler: createSummaryApiHandler(db, config) as (req: unknown, res: unknown) => Promise<void>,
      });
      api.registerHttpRoute({
        path: "/plugins/usage-limiter/api/history",
        handler: createHistoryApiHandler(db, config) as (req: unknown, res: unknown) => Promise<void>,
      });
      api.registerHttpRoute({
        path: "/plugins/usage-limiter/api/limits",
        handler: createLimitsApiHandler(db, config) as (req: unknown, res: unknown) => Promise<void>,
      });

      logger.info(
        "[usage-limiter] Dashboard available at /plugins/usage-limiter/dashboard"
      );
    }
  },
};

export default plugin;
