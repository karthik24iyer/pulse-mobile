// The quiet window of a night: where Recovery reads HRV and sleeping heart rate (Pulse+ change, not the reference study).
// RMSSD is most reproducible in slow-wave (deep) sleep (Herzig et al. 2018, Front Physiol 8:1100: ICC 0.84 against 0.71
// in REM and 0.69 in stage 2); REM and brief wakings push it around (Trinder et al. 2001, J Sleep Res; Stein & Pu 2012,
// Sleep Med Rev). So the night's value comes from the samples inside its deep-sleep segments, averaged on the log scale
// HRV monitoring uses (Plews et al. 2013, Sports Med). WHOOP describes the same choice ("HRV during slow-wave sleep").
// Fitbit's stage labels are imperfect, so a night with too little deep sleep falls back to light and deep sleep (no
// REM), then to the whole night, and says which window it used.
import type { Stage } from "@/data/types";

export type QuietWindow = "deep" | "nrem" | "sleep";

/** HRV samples (one per 5 minutes on Fitbit) a window needs: 15 minutes. */
export const MIN_QUIET_HRV_SAMPLES = 3;
/** Minutes of heart rate a window needs. */
export const MIN_QUIET_HR_MINUTES = 15;

type Seg = { startTs: number; endTs: number; stage: Stage | "unspecified" };

const inAny = (t: number, segs: readonly Seg[]) => segs.some((g) => t >= g.startTs && t < g.endTs);

/**
 * The samples of the night's quiet window: those in deep-sleep segments when there are at least `min` of them, else
 * those in light or deep sleep, else every sample inside the night [startTs, endTs). `segs`: the night's stage segments
 * (empty for an unstaged night). Null with no sample in the night.
 */
export function quietSamples<T extends { ts: number }>(
  xs: readonly T[],
  night: { startTs: number; endTs: number },
  segs: readonly Seg[],
  min: number,
): { samples: T[]; window: QuietWindow } | null {
  const all = xs.filter((x) => x.ts >= night.startTs && x.ts < night.endTs);
  if (!all.length) return null;
  const deep = segs.filter((g) => g.stage === "deep");
  const inDeep = all.filter((x) => inAny(x.ts, deep));
  if (inDeep.length >= min) return { samples: inDeep, window: "deep" };
  const nrem = segs.filter((g) => g.stage === "deep" || g.stage === "light");
  const inNrem = all.filter((x) => inAny(x.ts, nrem));
  if (inNrem.length >= min) return { samples: inNrem, window: "nrem" };
  return { samples: all, window: "sleep" };
}

/** The geometric mean of positive values (exp of the mean ln), or null with none: an HRV night on the log scale. */
export function geometricMean(xs: readonly number[]): number | null {
  const pos = xs.filter((x) => Number.isFinite(x) && x > 0);
  if (!pos.length) return null;
  return Math.exp(pos.reduce((a, x) => a + Math.log(x), 0) / pos.length);
}
