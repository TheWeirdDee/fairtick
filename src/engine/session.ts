import type { Session, SessionName } from "./types.js";

/**
 * US market holidays that fully close cash equities trading. Deliberately
 * empty until populated from a verified source (e.g. nyse.com's published
 * holiday calendar) for each year in use. The PRD is explicit that guessing
 * is worse than omitting: "Wrong holidays are worse than omitting them." An
 * unlisted holiday falls through to the ordinary weekday session logic below
 * (e.g. it will read as REGULAR/PRE/POST), which is the documented, honest
 * fallback rather than a fabricated HOLIDAY classification.
 */
export const KNOWN_MARKET_HOLIDAYS: ReadonlySet<string> = new Set([
  // "YYYY-MM-DD" in America/New_York local date. Populate from a verified
  // source before relying on HOLIDAY classification in production.
]);

const NY_TZ = "America/New_York";

interface NyParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday .. 6 = Saturday
}

function getNyParts(date: Date): NyParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // hour "24" for midnight under hour12:false in some ICU builds — normalize.
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function localDateKey(p: NyParts): string {
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Pure function: classifies the cash-equities session for a given instant,
 * in America/New_York local time. No network or LLM calls (PRD §10).
 */
export function sessionAt(date: Date): Session {
  const p = getNyParts(date);
  const minutesOfDay = p.hour * 60 + p.minute;
  const isWeekday = p.weekday >= 1 && p.weekday <= 5;

  const REGULAR_OPEN = 9 * 60 + 30; // 09:30
  const REGULAR_CLOSE = 16 * 60; // 16:00
  const PRE_OPEN = 4 * 60; // 04:00
  const POST_CLOSE = 20 * 60; // 20:00

  let name: SessionName;

  if (isWeekday && KNOWN_MARKET_HOLIDAYS.has(localDateKey(p))) {
    name = "HOLIDAY";
  } else if (
    // Friday 20:00 through Monday 04:00 is WEEKEND.
    (p.weekday === 5 && minutesOfDay >= POST_CLOSE) ||
    p.weekday === 6 ||
    (p.weekday === 0) ||
    (p.weekday === 1 && minutesOfDay < PRE_OPEN)
  ) {
    name = "WEEKEND";
  } else if (isWeekday && minutesOfDay >= REGULAR_OPEN && minutesOfDay < REGULAR_CLOSE) {
    name = "REGULAR";
  } else if (isWeekday && minutesOfDay >= PRE_OPEN && minutesOfDay < REGULAR_OPEN) {
    name = "PRE";
  } else if (isWeekday && minutesOfDay >= REGULAR_CLOSE && minutesOfDay < POST_CLOSE) {
    name = "POST";
  } else {
    // Remaining weekday hours: Mon-Thu 20:00-04:00(next), or Tue-Fri 00:00-04:00.
    name = "OVERNIGHT";
  }

  return {
    name,
    cashMarketOpen: name === "REGULAR",
    tz: NY_TZ,
    asOf: date.toISOString(),
  };
}
