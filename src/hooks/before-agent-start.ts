/**
 * before_agent_start hook:
 * - At >= 100%: inject context telling agent not to respond (defense in depth)
 * - At >= 80%: inject warning with model downgrade suggestion
 */

import type Database from "better-sqlite3";
import type { PluginConfig } from "../config.js";
import { checkAllBudgets, getWorstStatus, type BudgetStatus } from "../limits.js";
import {
  formatWarningContext,
  formatBlockContext,
} from "../downgrade.js";

type BeforeAgentStartEvent = {
  prompt: string;
  messages?: unknown[];
};

type BeforeAgentStartResult = {
  systemPrompt?: string;
  prependContext?: string;
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

export function createBeforeAgentStartHook(
  db: Database.Database,
  config: PluginConfig,
  logger: Logger
) {
  return (
    _event: BeforeAgentStartEvent,
    _ctx: AgentContext
  ): BeforeAgentStartResult | void => {
    try {
      const statuses = checkAllBudgets(db, config);
      const worst = getWorstStatus(statuses);

      if (worst === "blocked") {
        const blocked = statuses.filter((s) => s.status === "blocked");
        logger.warn(
          `[usage-limiter] Budget exceeded - blocking agent start: ${blocked.map((b) => `${b.period}/${b.limitType}`).join(", ")}`
        );
        return { prependContext: formatBlockContext(blocked) };
      }

      if (worst === "warn") {
        const warnings = statuses.filter(
          (s) => s.status === "warn" || s.status === "blocked"
        );
        logger.info(
          `[usage-limiter] Approaching limits: ${warnings.map((w) => `${w.period}/${w.limitType} at ${(w.ratio * 100).toFixed(1)}%`).join(", ")}`
        );
        return {
          prependContext: formatWarningContext(
            warnings,
            config.fallbackModel,
            config.autoDowngrade
          ),
        };
      }
    } catch (err) {
      logger.error(
        `[usage-limiter] Error in before_agent_start hook: ${err}`
      );
    }

    return undefined;
  };
}
