// Per-day aggregates and the 60-day pooled baselines. Reference study, shared-machinery.md § G05 (baselines) and
// § G07 (calibration). Each day keeps one aggregate per metric; a day's baseline pools the aggregates of up to 60 days
// BEFORE it, never the day itself (causality), so a later night never changes an earlier baseline.
//
// Two ways to pool, by metric:
// - daily: the day's value is the mean of its samples, and the baseline is the population mean and SD of those day
//   values (resting HRV, temperature);
// - combined: the day keeps the mean, population SD and count of its samples, and the baseline merges them with Chan's
//   formula (resting HR, respiratory rate, inactive HR, average HRV).
// No outlier rejection and no minimum count: one prior day gives a baseline with SD 0. Non-finite values are skipped
// (the source let them through, and its histogram trapped on them).
import { popStats } from "./math";

/** A day's (or a baseline's) statistics. `hist`: whole-bpm bins and counts, ascending, for the inactive-HR CDF. */
export type Agg = { avg: number; sd: number; count: number; hist?: [number, number][] };

const finite = (xs: readonly number[]) => xs.filter(Number.isFinite);

/** A daily metric's day value: the mean of its samples, as one entry (sd 0, count 1); null with none. */
export function dailyAgg(values: readonly number[]): Agg | null {
  const s = popStats(finite(values));
  return s && { avg: s.mean, sd: 0, count: 1 };
}

/** A combined metric's day value: mean, population SD and count of its samples; null with none. */
export function combinedAgg(values: readonly number[], withHist = false): Agg | null {
  const xs = finite(values);
  const s = popStats(xs);
  if (!s) return null;
  return { avg: s.mean, sd: s.sd, count: s.n, ...(withHist && { hist: histogram(xs) }) };
}

/** Whole-bpm bins (truncated toward zero, as the source), ascending. */
export function histogram(values: readonly number[]): [number, number][] {
  const m = new Map<number, number>();
  for (const v of values) if (Number.isFinite(v)) m.set(Math.trunc(v), (m.get(Math.trunc(v)) ?? 0) + 1);
  return [...m].sort((a, b) => a[0] - b[0]);
}

export function mergeHist(hists: readonly (readonly [number, number][])[]): [number, number][] {
  const m = new Map<number, number>();
  for (const h of hists) for (const [k, c] of h) m.set(k, (m.get(k) ?? 0) + c);
  return [...m].sort((a, b) => a[0] - b[0]);
}

/**
 * Chan's pairwise merge of per-day statistics, oldest first, with (n − 1) weights as the source (each day's SD is a
 * population SD, the merge treats it as a sample one). In doubles (fix 18).
 */
export function chanMerge(entries: readonly Agg[]): Agg | null {
  if (!entries.length) return null;
  let M = entries[0].avg;
  let V = entries[0].sd * entries[0].sd;
  let N = entries[0].count;
  for (const e of entries.slice(1)) {
    const n = e.count;
    const NN = n + N;
    const d = e.avg - M;
    M = (d * n) / NN + M;
    V = ((N - 1) * V + e.sd * e.sd * (n - 1) + d * d * ((n * N) / NN)) / (NN - 1);
    N = NN;
  }
  const hists = entries.flatMap((e) => (e.hist ? [e.hist] : []));
  return { avg: M, sd: Math.sqrt(V), count: N, ...(hists.length && { hist: mergeHist(hists) }) };
}

/** Population mean and SD of the entries' day values; count = days. */
export function dailyPool(entries: readonly Agg[]): Agg | null {
  const s = popStats(entries.map((e) => e.avg));
  return s && { avg: s.mean, sd: s.sd, count: s.n };
}

export type Pooling = "daily" | "combined";

/** Days a baseline pools (the source's window generator; the 30-day setting it also had was never read). */
export const BASELINE_DAYS = 60;

/**
 * A day's baseline from the aggregates of the days before it, oldest first (pass at most BASELINE_DAYS; missing days
 * are null and skipped). Null when none of them has a value.
 */
export function baseline(prior: readonly (Agg | null | undefined)[], pooling: Pooling): Agg | null {
  const entries = prior.slice(-BASELINE_DAYS).filter((e): e is Agg => e != null);
  return pooling === "combined" ? chanMerge(entries) : dailyPool(entries);
}

/**
 * Whether a score is calibrated (day numbers of its first and latest data day, and how many there are): they span at least `spanDays` (first + span <= last) and there are at least
 * 5 of them. Reference study, shared-machinery.md § G07 (Recovery 60 days, Stress 30). The source showed this as a badge
 * only; the Pulse engine shows the score from the first day it can, marked provisional until calibrated (fix 17).
 */
export function calibrated(firstDay: number, lastDay: number, dataDays: number, spanDays: number): boolean {
  return dataDays >= 5 && firstDay + spanDays <= lastDay;
}

/** Recovery's calibration span: 30 days in Pulse+ (the study's 60), matching its 30-night HRV and resting-HR baselines. */
export const RECOVERY_CALIBRATION_DAYS = 30;
export const STRESS_CALIBRATION_DAYS = 30;
