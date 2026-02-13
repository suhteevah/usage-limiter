/**
 * CLI commands for usage-limiter plugin.
 * Registered via api.registerCli().
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
import {
  queryUsageHistory,
  queryModelUsage,
  setOverrideLimit,
  removeOverrideLimit,
  recordReset,
  pruneOldRecords,
} from "../db.js";
import { getPeriodStart, getPeriodEnd } from "../periods.js";

type CliContext = {
  program: {
    command: (name: string) => CliCommand;
  };
  config: unknown;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

type CliCommand = {
  description: (desc: string) => CliCommand;
  argument: (name: string, desc?: string) => CliCommand;
  option: (flags: string, desc?: string, defaultVal?: string) => CliCommand;
  action: (fn: (...args: unknown[]) => void) => CliCommand;
  command: (name: string) => CliCommand;
};

export function createUsageCli(db: Database.Database, config: PluginConfig) {
  return (ctx: CliContext): void => {
    const cmd = ctx.program.command("usage-limiter").description("Manage usage limits and view usage data");

    // ── status ─────────────────────────────────────────────
    cmd
      .command("status")
      .description("View current usage against configured limits")
      .action(() => {
        const statuses = checkAllBudgets(db, config);

        if (statuses.length === 0) {
          console.log("No usage limits configured.");
          console.log(
            "Set limits in openclaw.json under plugins.entries.usage-limiter.config.limits"
          );
          return;
        }

        console.log("\n  Usage Limiter Status");
        console.log("  " + "=".repeat(50));

        for (const period of ALL_PERIODS) {
          const periodStatuses = statuses.filter((s) => s.period === period);
          if (periodStatuses.length === 0) continue;

          console.log(`\n  ${periodLabel(period)}:`);
          for (const s of periodStatuses) {
            const pct = (s.ratio * 100).toFixed(1);
            const bar = formatProgressBar(s.ratio);
            const current = formatLimitValue(s.limitType, s.current);
            const limit = formatLimitValue(s.limitType, s.limit);
            const typeLabel =
              s.limitType.charAt(0).toUpperCase() + s.limitType.slice(1);
            const statusStr = statusEmoji(s.status);
            console.log(
              `    ${typeLabel.padEnd(9)} ${bar} ${pct.padStart(6)}% (${current}/${limit})  ${statusStr}`
            );
          }
        }
        console.log("");
      });

    // ── set-limit ──────────────────────────────────────────
    cmd
      .command("set-limit")
      .description("Set or override a budget limit")
      .argument("<period>", "daily | weekly | monthly")
      .argument("<type>", "tokens | cost | requests")
      .argument("<value>", "limit value (number)")
      .action(
        (period: unknown, type: unknown, value: unknown) => {
          const p = String(period);
          const t = String(type);
          const v = parseFloat(String(value));

          if (!["daily", "weekly", "monthly"].includes(p)) {
            console.error(`Invalid period: ${p}. Use daily, weekly, or monthly.`);
            return;
          }
          if (!["tokens", "cost", "requests"].includes(t)) {
            console.error(`Invalid type: ${t}. Use tokens, cost, or requests.`);
            return;
          }
          if (isNaN(v) || v < 0) {
            console.error(`Invalid value: ${value}. Must be a positive number.`);
            return;
          }

          setOverrideLimit(db, p, t, v);
          console.log(`Set ${p} ${t} limit to ${formatLimitValue(t as "tokens" | "cost" | "requests", v)}`);
        }
      );

    // ── remove-limit ───────────────────────────────────────
    cmd
      .command("remove-limit")
      .description("Remove a limit override (revert to config file limit)")
      .argument("<period>", "daily | weekly | monthly")
      .argument("<type>", "tokens | cost | requests")
      .action(
        (period: unknown, type: unknown) => {
          removeOverrideLimit(db, String(period), String(type));
          console.log(`Removed ${period} ${type} limit override.`);
        }
      );

    // ── reset ──────────────────────────────────────────────
    cmd
      .command("reset")
      .description("Reset usage counters for a period")
      .argument("[period]", "daily | weekly | monthly | all (default: all)")
      .action((period: unknown) => {
        const p = period ? String(period) : "all";
        if (!["daily", "weekly", "monthly", "all"].includes(p)) {
          console.error(`Invalid period: ${p}.`);
          return;
        }
        recordReset(db, p);
        console.log(`Reset ${p} usage counters.`);
      });

    // ── history ────────────────────────────────────────────
    cmd
      .command("history")
      .description("Show daily usage history")
      .option("--days <n>", "Number of days to show", "7")
      .action((opts: unknown) => {
        const options = opts as { days?: string };
        const days = parseInt(options.days ?? "7", 10);
        const now = Date.now();
        const fromTs = now - days * 24 * 60 * 60 * 1000;

        const history = queryUsageHistory(db, fromTs, now);

        if (history.length === 0) {
          console.log(`No usage data in the last ${days} days.`);
          return;
        }

        console.log(`\n  Usage History (Last ${days} Days)`);
        console.log("  " + "=".repeat(55));
        console.log(
          "  " +
            "Date".padEnd(12) +
            "Tokens".padStart(12) +
            "Cost".padStart(10) +
            "Requests".padStart(10)
        );
        console.log("  " + "-".repeat(55));

        for (const entry of history) {
          console.log(
            "  " +
              entry.date.padEnd(12) +
              formatLimitValue("tokens", entry.totalTokens).padStart(12) +
              formatLimitValue("cost", entry.totalCost).padStart(10) +
              String(entry.requestCount).padStart(10)
          );
        }
        console.log("");
      });

    // ── models ─────────────────────────────────────────────
    cmd
      .command("models")
      .description("Show model usage breakdown for the current day")
      .action(() => {
        const periodStart = getPeriodStart("daily", config.timezone);
        const models = queryModelUsage(db, periodStart);

        if (models.length === 0) {
          console.log("No model usage recorded today.");
          return;
        }

        console.log("\n  Model Usage (Today)");
        console.log("  " + "=".repeat(60));
        console.log(
          "  " +
            "Model".padEnd(30) +
            "Tokens".padStart(12) +
            "Cost".padStart(10) +
            "Reqs".padStart(8)
        );
        console.log("  " + "-".repeat(60));

        for (const m of models) {
          const name = `${m.provider}/${m.model}`;
          console.log(
            "  " +
              name.padEnd(30) +
              formatLimitValue("tokens", m.totalTokens).padStart(12) +
              formatLimitValue("cost", m.totalCost).padStart(10) +
              String(m.requestCount).padStart(8)
          );
        }
        console.log("");
      });

    // ── prune ──────────────────────────────────────────────
    cmd
      .command("prune")
      .description("Remove old usage records")
      .option("--days <n>", "Keep records newer than N days", "90")
      .action((opts: unknown) => {
        const options = opts as { days?: string };
        const days = parseInt(options.days ?? "90", 10);
        const removed = pruneOldRecords(db, days);
        console.log(`Pruned ${removed} records older than ${days} days.`);
      });
  };
}
