/**
 * Period boundary computation for usage tracking.
 * Computes the start timestamp (epoch ms) for daily/weekly/monthly periods
 * in a given timezone.
 */

export type Period = "daily" | "weekly" | "monthly";

/**
 * Get the start of the current period as a Unix epoch timestamp (ms).
 *
 * - daily: midnight today in the configured timezone
 * - weekly: most recent Monday midnight
 * - monthly: 1st of current month midnight
 */
export function getPeriodStart(
  period: Period,
  timezone: string = "UTC",
  now: Date = new Date()
): number {
  // Format the current time in the target timezone to extract date parts
  const parts = getDatePartsInTimezone(now, timezone);

  switch (period) {
    case "daily":
      return midnightInTimezone(parts.year, parts.month, parts.day, timezone);

    case "weekly": {
      // dayOfWeek: 0=Sun, 1=Mon, ..., 6=Sat
      // We want Monday as the start of the week
      const daysBack = parts.dayOfWeek === 0 ? 6 : parts.dayOfWeek - 1;
      const mondayDate = new Date(parts.year, parts.month - 1, parts.day - daysBack);
      const mondayParts = getDatePartsInTimezone(mondayDate, timezone);
      return midnightInTimezone(mondayParts.year, mondayParts.month, mondayParts.day, timezone);
    }

    case "monthly":
      return midnightInTimezone(parts.year, parts.month, 1, timezone);

    default:
      throw new Error(`Unknown period: ${period}`);
  }
}

/**
 * Get the end of the current period as a Unix epoch timestamp (ms).
 * This is the start of the next period.
 */
export function getPeriodEnd(
  period: Period,
  timezone: string = "UTC",
  now: Date = new Date()
): number {
  const parts = getDatePartsInTimezone(now, timezone);

  switch (period) {
    case "daily":
      return midnightInTimezone(parts.year, parts.month, parts.day + 1, timezone);

    case "weekly": {
      const daysBack = parts.dayOfWeek === 0 ? 6 : parts.dayOfWeek - 1;
      const nextMondayDay = parts.day - daysBack + 7;
      return midnightInTimezone(parts.year, parts.month, nextMondayDay, timezone);
    }

    case "monthly": {
      const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
      const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
      return midnightInTimezone(nextYear, nextMonth, 1, timezone);
    }

    default:
      throw new Error(`Unknown period: ${period}`);
  }
}

type DateParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
};

function getDatePartsInTimezone(date: Date, timezone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const find = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const weekdayStr = find("weekday");
  const dayOfWeekMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    year: parseInt(find("year"), 10),
    month: parseInt(find("month"), 10),
    day: parseInt(find("day"), 10),
    dayOfWeek: dayOfWeekMap[weekdayStr] ?? 0,
  };
}

/**
 * Compute the Unix epoch ms for midnight of a given date in a timezone.
 * Uses a binary search approach to handle DST transitions correctly.
 */
function midnightInTimezone(
  year: number,
  month: number,
  day: number,
  timezone: string
): number {
  // Start with a rough UTC estimate
  const utcEstimate = Date.UTC(year, month - 1, day);

  // Use Intl to find the actual date at that UTC time in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  // Adjust by checking offset - iterate to converge
  let ts = utcEstimate;
  for (let i = 0; i < 3; i++) {
    const parts = formatter.formatToParts(new Date(ts));
    const find = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";

    const actualDay = parseInt(find("day"), 10);
    const actualMonth = parseInt(find("month"), 10);
    const actualHour = parseInt(find("hour"), 10);
    const actualMinute = parseInt(find("minute"), 10);

    if (actualMonth === month && actualDay === day && actualHour === 0 && actualMinute === 0) {
      return ts;
    }

    // Compute offset: the local time at `ts` minus what we want (midnight of target day)
    const localMs =
      Date.UTC(year, month - 1, actualDay, actualHour, actualMinute) -
      Date.UTC(year, month - 1, day, 0, 0);
    ts -= localMs;
  }

  return ts;
}

/** Human-readable period label */
export function periodLabel(period: Period): string {
  return period.charAt(0).toUpperCase() + period.slice(1);
}

/** All tracked periods */
export const ALL_PERIODS: Period[] = ["daily", "weekly", "monthly"];
