// Recovery, 1–100. Reference study, recovery-stress-energy.md § Recovery: 0.4·HRV + 0.3·RHR + 0.3·Sleep Score, then the
// respiratory-rate and temperature adjustments, clamped to [1, 100]. SpO2 is left out: Fitbit does not write it to
// Health Connect. Doubles throughout (fix 18).
//
// Pulse+ changes to the HRV and resting-HR terms (the study mapped z in [−1, 1] onto 0–100 and gave 0 below −1):
// - HRV is last night's deep-sleep HRV (quietWindow.ts) on the log scale, ln(RMSSD), against a baseline of ln values
//   (Plews et al. 2012, Eur J Appl Physiol; 2013, Sports Med);
// - resting HR is the mean heart rate in the same deep-sleep window;
// - both map through the normal band HRV-guided training uses (Vesterinen et al. 2016, MSSE; Javaloyes et al. 2019,
//   IJSPP: mean ± 0.5 SD is "normal"): within ±0.5 SD a term scores 40–60, beyond it moves in a straight line to 0 or
//   100 at ±2 SD. The band is from the research; the straight line past it is a design choice (no study compared
//   mapping curves), chosen so a very bad night scores below a merely bad one instead of both reading 0.
import type { Agg } from "./baselines";
import { clamp } from "./math";

/** Half-width of the normal band, in SDs (Vesterinen 2016; Javaloyes 2019). */
export const BAND_SD = 0.5;
/** Where a term reaches 0 or 100, in SDs. */
export const FULL_SD = 2;

/**
 * A term on 0–100 from a z oriented so higher is better: 50 + 20·z inside ±0.5 SD (40–60), then straight on to 100 at
 * +2 SD and 0 at −2 SD, flat beyond.
 */
export function bandScore(z: number): number {
  const a = Math.abs(z);
  if (a <= BAND_SD) return 50 + (10 / BAND_SD) * z;
  return 50 + Math.sign(z) * Math.min(50, 10 + ((a - BAND_SD) / (FULL_SD - BAND_SD)) * 40);
}

/** HRV's z on the log scale: (ln ms − mean) / sd of a baseline of ln values; 0 with SD 0, null for a non-positive reading. */
export function hrvLnZ(ms: number, lnBase: Agg): number | null {
  if (!(ms > 0)) return null;
  return lnBase.sd === 0 ? 0 : (Math.log(ms) - lnBase.avg) / lnBase.sd;
}

/** Resting HR's z, oriented so higher is better (a lower heart rate); 0 with SD 0. */
export const rhrZ = (bpm: number, base: Agg) => (base.sd === 0 ? 0 : -(bpm - base.avg) / base.sd);

/** Lower is better (respiratory rate): the study's map, z = −(cur − mean) / sd in [−1, 1] onto 0–100; SD 0 gives 50. */
export function compDown(cur: number, b: Agg): number {
  if (b.sd === 0) return 50;
  const z = -(cur - b.avg) / b.sd;
  return z < -1 ? 0 : (Math.min(z, 1) * 0.5 + 0.5) * 100;
}

/** Respiratory rate: (component − 50) · 0.2, so ±10 points at most. */
export const rrAdjust = (cur: number, b: Agg) => (compDown(cur, b) - 50) * 0.2;

/** Temperature above baseline only lowers the score: 30·atan(min(z, 0) / 10), at least −30, with z = −(cur − mean) / sd. */
export function tempAdjust(cur: number, b: Agg): number {
  const z = b.sd === 0 ? 0 : -(cur - b.avg) / b.sd;
  return Math.max(-30, Math.atan(Math.min(z, 0) / 10) * 30);
}

export type RecoveryInput = {
  /** Last night's deep-sleep HRV, ms. */
  hrv: number | null;
  /** Baseline of nightly ln(ms) values. */
  hrvBase: Agg | null;
  /** Last night's deep-sleep heart rate, bpm. */
  rhr: number | null;
  rhrBase: Agg | null;
  sleepScore: number | null;
  resp?: number | null;
  respBase?: Agg | null;
  temp?: number | null;
  tempBase?: Agg | null;
};

export type RecoveryMissing = "hrv" | "hrvBaseline" | "rhr" | "rhrBaseline" | "sleepScore";

export type RecoveryResult =
  | { value: number; parts: { hrv: number; rhr: number; sleep: number; resp: number; temp: number }; hrvZ: number; rhrZ: number }
  | { value: null; missing: RecoveryMissing[] };

/** The score, or what it lacks (HRV, resting HR, their baselines, the Sleep Score; the adjustments never gate). */
export function recovery(a: RecoveryInput): RecoveryResult {
  const missing: RecoveryMissing[] = [];
  if (a.hrv == null || !(a.hrv > 0)) missing.push("hrv");
  if (a.hrvBase == null) missing.push("hrvBaseline");
  if (a.rhr == null) missing.push("rhr");
  if (a.rhrBase == null) missing.push("rhrBaseline");
  if (a.sleepScore == null) missing.push("sleepScore");
  if (missing.length) return { value: null, missing };
  const hz = hrvLnZ(a.hrv!, a.hrvBase!)!;
  const rz = rhrZ(a.rhr!, a.rhrBase!);
  const parts = {
    hrv: bandScore(hz),
    rhr: bandScore(rz),
    sleep: a.sleepScore!,
    resp: a.resp != null && a.respBase ? rrAdjust(a.resp, a.respBase) : 0,
    temp: a.temp != null && a.tempBase ? tempAdjust(a.temp, a.tempBase) : 0,
  };
  const sum = parts.hrv * 0.4 + parts.rhr * 0.3 + parts.sleep * 0.3 + parts.resp + parts.temp;
  return { value: clamp(sum, 1, 100), parts, hrvZ: hz, rhrZ: rz };
}

/** Recovery bands: high from 67, medium from 34 (reference study, shared-machinery.md § G09). */
export const recoveryBand = (v: number) => (v >= 67 ? "high" : v >= 34 ? "medium" : "low");
