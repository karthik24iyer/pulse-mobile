import { describe, expect, it } from "vitest";
import { bandScore, compDown, hrvLnZ, recovery, rhrZ, rrAdjust, tempAdjust } from "./recovery";

const b = (avg: number, sd: number) => ({ avg, sd, count: 30 });
/** An ln(ms) baseline centred on `ms`. */
const lnB = (ms: number, sd: number) => b(Math.log(ms), sd);

describe("bandScore", () => {
  it("is 40–60 inside ±0.5 SD, then straight to 0 and 100 at ±2 SD, flat beyond", () => {
    expect(bandScore(0)).toBe(50);
    expect(bandScore(0.25)).toBe(55);
    expect(bandScore(0.5)).toBe(60);
    expect(bandScore(-0.5)).toBe(40);
    expect(bandScore(1.25)).toBeCloseTo(80);
    expect(bandScore(-1.25)).toBeCloseTo(20);
    expect(bandScore(2)).toBe(100);
    expect(bandScore(-2)).toBe(0);
    expect(bandScore(5)).toBe(100);
    expect(bandScore(-5)).toBe(0);
  });
  it("never decreases and has no jump at the band edges", () => {
    for (let z = -3; z < 3; z += 0.01) expect(bandScore(z + 0.01)).toBeGreaterThanOrEqual(bandScore(z));
    expect(bandScore(0.5 + 1e-9)).toBeCloseTo(60, 6);
    expect(bandScore(-0.5 - 1e-9)).toBeCloseTo(40, 6);
  });
  it("tells a very bad night from a merely bad one (the old ±1 SD clip scored both 0)", () => {
    expect(bandScore(-1.1)).toBeGreaterThan(bandScore(-1.5));
    expect(bandScore(-1.5)).toBeGreaterThan(0);
  });
});

describe("terms", () => {
  it("HRV is judged on the log scale; resting HR lower is better", () => {
    expect(hrvLnZ(50 * Math.exp(0.1), lnB(50, 0.2))).toBeCloseTo(0.5);
    expect(hrvLnZ(50, lnB(50, 0))).toBe(0);
    expect(hrvLnZ(0, lnB(50, 0.2))).toBeNull();
    expect(rhrZ(56, b(58, 2))).toBe(1);
    expect(rhrZ(60, b(58, 0))).toBe(0);
  });
  it("respiratory rate adjusts ±10; temperature only lowers, at most 30", () => {
    expect(compDown(62, b(60, 4))).toBe(25);
    expect(rrAdjust(16, b(15, 1))).toBe(-10);
    expect(rrAdjust(14, b(15, 1))).toBe(10);
    expect(tempAdjust(-0.5, b(0, 0.2))).toBe(0);
    expect(tempAdjust(1, b(0, 0.1))).toBeCloseTo(30 * Math.atan(-1));
    expect(tempAdjust(100, b(0, 0.1))).toBe(-30);
  });
});

describe("recovery", () => {
  it("golden: ln HRV +0.5 SD, resting HR at baseline, sleep 80, respiration up 0.5 SD", () => {
    // 0.4 · 60 + 0.3 · 50 + 0.3 · 80 + (25 − 50) · 0.2 = 24 + 15 + 24 − 5 = 58
    const r = recovery({ hrv: 50 * Math.exp(0.1), hrvBase: lnB(50, 0.2), rhr: 52, rhrBase: b(52, 3), sleepScore: 80, resp: 15.5, respBase: b(15, 1) });
    expect(r.value).toBeCloseTo(58);
    expect(r.value != null && r.hrvZ).toBeCloseTo(0.5);
  });
  it("golden: everything at baseline gives 0.4 · 50 + 0.3 · 50 + 0.3 · sleep", () => {
    expect(recovery({ hrv: 45, hrvBase: lnB(45, 0.15), rhr: 50, rhrBase: b(50, 2), sleepScore: 70 }).value).toBeCloseTo(56);
  });
  it("clamps to [1, 100]", () => {
    expect(recovery({ hrv: 5, hrvBase: lnB(50, 0.1), rhr: 99, rhrBase: b(60, 1), sleepScore: 0, temp: 9, tempBase: b(0, 0.1) }).value).toBe(1);
    expect(recovery({ hrv: 90, hrvBase: lnB(50, 0.1), rhr: 40, rhrBase: b(60, 1), sleepScore: 100, resp: 10, respBase: b(15, 1) }).value).toBe(100);
  });
  it("lists what it lacks; the adjustments never gate; a non-positive HRV counts as missing", () => {
    expect(recovery({ hrv: null, hrvBase: null, rhr: 60, rhrBase: b(60, 4), sleepScore: null })).toEqual({ value: null, missing: ["hrv", "hrvBaseline", "sleepScore"] });
    expect(recovery({ hrv: 0, hrvBase: lnB(50, 0.2), rhr: 60, rhrBase: b(60, 4), sleepScore: 70 })).toEqual({ value: null, missing: ["hrv"] });
    expect(recovery({ hrv: 50, hrvBase: lnB(50, 0.2), rhr: 60, rhrBase: b(60, 4), sleepScore: 70, resp: null, respBase: null }).value).toBeCloseTo(56);
  });
  it("more HRV never lowers Recovery; a higher resting HR never raises it", () => {
    const at = (hrv: number, rhr: number) => recovery({ hrv, hrvBase: lnB(50, 0.18), rhr, rhrBase: b(55, 2.5), sleepScore: 75 }).value!;
    for (let h = 15; h < 120; h += 1) expect(at(h + 1, 55)).toBeGreaterThanOrEqual(at(h, 55));
    for (let r = 45; r < 70; r += 0.5) expect(at(50, r + 0.5)).toBeLessThanOrEqual(at(50, r));
  });
});
