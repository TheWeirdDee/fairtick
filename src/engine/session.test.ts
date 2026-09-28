import { describe, expect, it } from "vitest";
import { sessionAt } from "./session.js";

// Test vectors from FairTick_PRD.md §10, verified against America/New_York local time.
describe("sessionAt", () => {
  it("classifies Thursday 11:00 EDT as REGULAR", () => {
    const s = sessionAt(new Date("2026-09-24T15:00:00Z")); // 11:00 EDT Thu
    expect(s.name).toBe("REGULAR");
    expect(s.cashMarketOpen).toBe(true);
  });

  it("classifies Saturday 14:00 EDT as WEEKEND", () => {
    const s = sessionAt(new Date("2026-09-26T18:00:00Z")); // 14:00 EDT Sat
    expect(s.name).toBe("WEEKEND");
    expect(s.cashMarketOpen).toBe(false);
  });

  it("classifies Friday 17:00 EDT as POST", () => {
    const s = sessionAt(new Date("2026-09-25T21:00:00Z")); // 17:00 EDT Fri
    expect(s.name).toBe("POST");
    expect(s.cashMarketOpen).toBe(false);
  });

  it("classifies Thursday 21:00 EDT as OVERNIGHT", () => {
    const s = sessionAt(new Date("2026-09-25T01:00:00Z")); // 21:00 EDT Thu
    expect(s.name).toBe("OVERNIGHT");
    expect(s.cashMarketOpen).toBe(false);
  });

  it("classifies Friday 20:00 EDT (weekend boundary) as WEEKEND, not POST", () => {
    const s = sessionAt(new Date("2026-09-26T00:00:00Z")); // 20:00 EDT Fri
    expect(s.name).toBe("WEEKEND");
  });

  it("classifies Monday 03:59 EDT as WEEKEND (still before the 04:00 boundary)", () => {
    const s = sessionAt(new Date("2026-09-28T07:59:00Z")); // 03:59 EDT Mon
    expect(s.name).toBe("WEEKEND");
  });

  it("classifies Monday 04:00 EDT as PRE (weekend has just ended)", () => {
    const s = sessionAt(new Date("2026-09-28T08:00:00Z")); // 04:00 EDT Mon
    expect(s.name).toBe("PRE");
  });

  it("classifies Monday 09:30 EDT as REGULAR (open boundary)", () => {
    const s = sessionAt(new Date("2026-09-28T13:30:00Z")); // 09:30 EDT Mon
    expect(s.name).toBe("REGULAR");
  });

  it("classifies Monday 16:00 EDT as POST (close boundary)", () => {
    const s = sessionAt(new Date("2026-09-28T20:00:00Z")); // 16:00 EDT Mon
    expect(s.name).toBe("POST");
  });

  it("recognizes verified Thanksgiving closure", () => {
    const s = sessionAt(new Date("2026-11-26T15:00:00Z")); // 10:00 EST Thu
    expect(s.name).toBe("HOLIDAY");
  });
  it("closes at 13:00 ET on the day after Thanksgiving", () => {
    expect(sessionAt(new Date("2026-11-27T17:59:59Z")).name).toBe("REGULAR");
    expect(sessionAt(new Date("2026-11-27T18:00:00Z")).name).toBe("POST");
  });
  it("does not assume unsupported calendar coverage is open", () => {
    expect(sessionAt(new Date("2027-01-04T15:00:00Z")).name).toBe("UNKNOWN");
  });
});
