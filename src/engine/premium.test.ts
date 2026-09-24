import { describe, expect, it } from "vitest";
import { computePremiumBps } from "./premium.js";

describe("computePremiumBps", () => {
  it("is positive when dex is rich to feed", () => {
    // dex $222.00 vs feed $221.97 -> ~1.35 bps rich
    const bps = computePremiumBps(222.0, 221.97);
    expect(bps).toBeCloseTo(1.3515, 3);
  });

  it("is negative when dex is cheap to feed", () => {
    const bps = computePremiumBps(221.78, 221.97);
    expect(bps).toBeLessThan(0);
    expect(bps).toBeCloseTo(-8.559, 2);
  });

  it("is zero when dex equals feed", () => {
    expect(computePremiumBps(100, 100)).toBe(0);
  });

  it("matches a known fixture within 0.1 bps", () => {
    // dex 221.9715095 vs feed 221.9719303 (live-captured values from DATA-CONTRACT.md)
    const bps = computePremiumBps(221.9715095, 221.9719303);
    expect(Math.abs(bps - -0.01896)).toBeLessThan(0.1);
  });

  it("throws on non-positive feed price rather than dividing by zero", () => {
    expect(() => computePremiumBps(100, 0)).toThrow();
    expect(() => computePremiumBps(100, -5)).toThrow();
  });

  it("throws on non-finite input", () => {
    expect(() => computePremiumBps(NaN, 100)).toThrow();
    expect(() => computePremiumBps(100, Infinity)).toThrow();
  });
});
