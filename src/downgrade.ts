/**
 * Model downgrade suggestion formatting.
 * Generates warning text that includes a suggestion to switch to a cheaper model.
 */

import type { BudgetStatus } from "./limits.js";
import {
  formatLimitValue,
  formatProgressBar,
  statusEmoji,
} from "./limits.js";
import { periodLabel } from "./periods.js";

/**
 * Format a warning message for the agent's prependContext when approaching limits.
 * Includes a model downgrade suggestion if fallbackModel is configured.
 */
export function formatWarningContext(
  warnings: BudgetStatus[],
  fallbackModel?: string,
  autoDowngrade: boolean = false
): string {
  const lines: string[] = [
    "--- USAGE LIMIT WARNING ---",
    "You are approaching your configured usage limits:",
    "",
  ];

  for (const w of warnings) {
    const pct = (w.ratio * 100).toFixed(1);
    lines.push(
      `  ${periodLabel(w.period)} ${w.limitType}: ${formatLimitValue(w.limitType, w.current)} / ${formatLimitValue(w.limitType, w.limit)} (${pct}%) ${formatProgressBar(w.ratio)}`
    );
  }

  lines.push("");

  if (fallbackModel) {
    if (autoDowngrade) {
      lines.push(
        `IMPORTANT: To conserve budget, you MUST use the model "${fallbackModel}" for this response.`,
        `The user has configured automatic model downgrade at the warning threshold.`,
        `Please generate a concise, efficient response to minimize token usage.`
      );
    } else {
      lines.push(
        `Tip: The user can switch to a cheaper model to conserve budget:`,
        `  /model ${fallbackModel}`,
        ``,
        `Please inform the user about their current usage levels and suggest switching models if appropriate.`
      );
    }
  } else {
    lines.push(
      `Please inform the user about their current usage levels.`,
      `Consider generating concise responses to conserve budget.`
    );
  }

  lines.push("--- END WARNING ---");
  return lines.join("\n");
}

/**
 * Format a block message sent to the user when budget is exceeded.
 */
export function formatBlockMessage(blocked: BudgetStatus[]): string {
  const lines: string[] = [
    "Usage limit reached. Your request has been blocked to prevent overspending.",
    "",
  ];

  for (const b of blocked) {
    const pct = (b.ratio * 100).toFixed(1);
    lines.push(
      `  ${periodLabel(b.period)} ${b.limitType}: ${formatLimitValue(b.limitType, b.current)} / ${formatLimitValue(b.limitType, b.limit)} (${pct}%)`
    );
  }

  lines.push(
    "",
    "Limits will reset at the start of the next period.",
    "Use /usage to check current status, or ask your admin to adjust limits."
  );

  return lines.join("\n");
}

/**
 * Format the block context prepended to agent start when fully blocked.
 * This is defense-in-depth; the real block is in message_sending.
 */
export function formatBlockContext(blocked: BudgetStatus[]): string {
  const lines: string[] = [
    "--- USAGE LIMIT EXCEEDED ---",
    "The user's budget has been exceeded. DO NOT generate a response.",
    "The following limits have been reached:",
    "",
  ];

  for (const b of blocked) {
    lines.push(
      `  ${periodLabel(b.period)} ${b.limitType}: ${formatLimitValue(b.limitType, b.current)} / ${formatLimitValue(b.limitType, b.limit)}`
    );
  }

  lines.push(
    "",
    "Respond only with a brief notice that the budget has been exceeded.",
    "--- END ---"
  );

  return lines.join("\n");
}
