/**
 * Plugin configuration type and resolver.
 * Maps the JSON schema from openclaw.plugin.json to a typed interface.
 */

import type { Period } from "./periods.js";

export type PeriodLimits = {
  tokens?: number;
  cost?: number;
  requests?: number;
};

export type PluginConfig = {
  limits: Partial<Record<Period, PeriodLimits>>;
  warnThreshold: number;
  blockThreshold: number;
  timezone: string;
  fallbackModel?: string;
  autoDowngrade: boolean;
  dashboardEnabled: boolean;
};

const DEFAULTS: PluginConfig = {
  limits: {},
  warnThreshold: 0.8,
  blockThreshold: 1.0,
  timezone: "UTC",
  autoDowngrade: false,
  dashboardEnabled: true,
};

/**
 * Resolve raw plugin config (from api.pluginConfig) into a typed PluginConfig
 * with defaults applied.
 */
export function resolvePluginConfig(
  raw: Record<string, unknown> | undefined
): PluginConfig {
  if (!raw) return { ...DEFAULTS };

  const limits: Partial<Record<Period, PeriodLimits>> = {};
  const rawLimits = raw.limits as Record<string, unknown> | undefined;

  if (rawLimits && typeof rawLimits === "object") {
    for (const period of ["daily", "weekly", "monthly"] as Period[]) {
      const pl = rawLimits[period] as Record<string, unknown> | undefined;
      if (pl && typeof pl === "object") {
        limits[period] = {
          tokens: typeof pl.tokens === "number" ? pl.tokens : undefined,
          cost: typeof pl.cost === "number" ? pl.cost : undefined,
          requests: typeof pl.requests === "number" ? pl.requests : undefined,
        };
      }
    }
  }

  return {
    limits,
    warnThreshold:
      typeof raw.warnThreshold === "number"
        ? raw.warnThreshold
        : DEFAULTS.warnThreshold,
    blockThreshold:
      typeof raw.blockThreshold === "number"
        ? raw.blockThreshold
        : DEFAULTS.blockThreshold,
    timezone:
      typeof raw.timezone === "string" ? raw.timezone : DEFAULTS.timezone,
    fallbackModel:
      typeof raw.fallbackModel === "string" ? raw.fallbackModel : undefined,
    autoDowngrade:
      typeof raw.autoDowngrade === "boolean"
        ? raw.autoDowngrade
        : DEFAULTS.autoDowngrade,
    dashboardEnabled:
      typeof raw.dashboardEnabled === "boolean"
        ? raw.dashboardEnabled
        : DEFAULTS.dashboardEnabled,
  };
}
