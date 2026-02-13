/**
 * agent_end hook:
 * Fallback usage recording when diagnostic events are not available.
 * Extracts usage from the last assistant message in the event.
 */

import type Database from "better-sqlite3";
import type { PluginConfig } from "../config.js";
import { recordUsage, type UsageRecord } from "../db.js";

type AgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
};

type AgentContext = {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  messageProvider?: string;
};

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

// Track recently recorded timestamps to avoid duplicates with diagnostic service
const recentTimestamps = new Set<number>();
const MAX_RECENT = 100;

export function markTimestampRecorded(ts: number): void {
  recentTimestamps.add(ts);
  if (recentTimestamps.size > MAX_RECENT) {
    const first = recentTimestamps.values().next().value;
    if (first !== undefined) recentTimestamps.delete(first);
  }
}

export function isTimestampRecorded(ts: number): boolean {
  return recentTimestamps.has(ts);
}

export function createAgentEndHook(
  db: Database.Database,
  _config: PluginConfig,
  logger: Logger
) {
  return (_event: AgentEndEvent, ctx: AgentContext): void => {
    try {
      const messages = _event.messages as Array<Record<string, unknown>>;
      if (!messages || !Array.isArray(messages)) return;

      // Walk backwards to find the last assistant message with usage
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg || msg.role !== "assistant") continue;

        const usage = msg.usage as Record<string, number> | undefined;
        if (!usage) continue;

        const now = Date.now();

        // Skip if likely already recorded by diagnostic service
        // (dedup via ~2 second window)
        const ts = typeof msg.timestamp === "number" ? msg.timestamp : now;
        if (isTimestampRecorded(ts)) break;
        // Also check close timestamps
        for (let delta = -2000; delta <= 2000; delta += 500) {
          if (isTimestampRecorded(ts + delta)) {
            break;
          }
        }

        const record: UsageRecord = {
          timestamp: now,
          sessionKey: ctx.sessionKey,
          provider: typeof msg.provider === "string" ? msg.provider : undefined,
          model: typeof msg.model === "string" ? msg.model : undefined,
          inputTokens: usage.input ?? usage.inputTokens ?? usage.prompt_tokens ?? 0,
          outputTokens: usage.output ?? usage.outputTokens ?? usage.completion_tokens ?? 0,
          cacheReadTokens: usage.cacheRead ?? 0,
          cacheWriteTokens: usage.cacheWrite ?? 0,
          totalTokens: usage.total ?? 0,
          costUsd: typeof msg.cost === "number" ? msg.cost : 0,
          durationMs: _event.durationMs ?? 0,
        };

        // Compute total if not provided
        if (record.totalTokens === 0) {
          record.totalTokens =
            record.inputTokens +
            record.outputTokens +
            record.cacheReadTokens +
            record.cacheWriteTokens;
        }

        recordUsage(db, record);
        logger.info(
          `[usage-limiter] Recorded usage via agent_end fallback: ${record.totalTokens} tokens`
        );
        break;
      }
    } catch (err) {
      logger.error(`[usage-limiter] Error in agent_end hook: ${err}`);
    }
  };
}
