/**
 * /budget chat command.
 * Shows current usage against configured limits with progress bars.
 * Note: /usage is reserved by OpenClaw built-in, so we use /budget.
 */

import type Database from "better-sqlite3";
import type { PluginConfig } from "../config.js";
import {
  checkAllBudgets,
  formatLimitValue,
  formatProgressBar,
  statusEmoji,
} from "../limits.js";
import { periodLabel, ALL_PERIODS, type Period } from "../periods.js";
import { queryModelUsage } from "../db.js";
import { getPeriodStart } from "../periods.js";

type CommandContext = {
  senderId?: string;
  channel: string;
  isAuthorizedSender: boolean;
  args?: string;
  commandBody: string;
  config: unknown;
};

type CommandResult = {
  text?: string;
  content?: Array<{ type: string; text: string }>;
};

export function createUsageCommand(db: Database.Database, config: PluginConfig) {
  return {
    name: "budget",
    description: "Show current budget usage against configured limits",
    acceptsArgs: true,
    requireAuth: true,
    handler: (ctx: CommandContext): CommandResult => {
      const args = ctx.args?.trim();

      // /usage models - show model breakdown
      if (args === "models") {
        return { text: formatModelBreakdown(db, config) };
      }

      // Default: show budget status
      const statuses = checkAllBudgets(db, config);

      if (statuses.length === 0) {
        return {
          text: "No usage limits configured. Set limits in your openclaw.json under plugins.entries.usage-limiter.config.limits",
        };
      }

      const lines: string[] = ["Usage Status", "============", ""];

      for (const period of ALL_PERIODS) {
        const periodStatuses = statuses.filter((s) => s.period === period);
        if (periodStatuses.length === 0) continue;

        lines.push(`${periodLabel(period)}:`);
        for (const s of periodStatuses) {
          const pct = (s.ratio * 100).toFixed(1);
          const bar = formatProgressBar(s.ratio);
          const current = formatLimitValue(s.limitType, s.current);
          const limit = formatLimitValue(s.limitType, s.limit);
          const typeLabel = s.limitType.charAt(0).toUpperCase() + s.limitType.slice(1);
          lines.push(
            `  ${typeLabel.padEnd(8)} ${bar} ${pct.padStart(6)}% (${current}/${limit})  ${statusEmoji(s.status)}`
          );
        }
        lines.push("");
      }

      if (config.fallbackModel) {
        lines.push(`Fallback model: ${config.fallbackModel}`);
        lines.push(
          `Auto-downgrade: ${config.autoDowngrade ? "enabled" : "disabled"}`
        );
        lines.push("");
      }

      lines.push("Commands: /budget models | /budget");

      return { text: lines.join("\n") };
    },
  };
}

function formatModelBreakdown(db: Database.Database, config: PluginConfig): string {
  const periodStart = getPeriodStart("daily", config.timezone);
  const models = queryModelUsage(db, periodStart);

  if (models.length === 0) {
    return "No model usage recorded today.";
  }

  const lines: string[] = ["Model Usage (Today)", "===================", ""];

  for (const m of models) {
    lines.push(
      `${m.provider}/${m.model}: ${formatLimitValue("tokens", m.totalTokens)} tokens, ${formatLimitValue("cost", m.totalCost)}, ${m.requestCount} requests`
    );
  }

  return lines.join("\n");
}
