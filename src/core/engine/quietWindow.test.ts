import { describe, expect, it } from "vitest";
import { geometricMean, quietSamples } from "./quietWindow";

const night = { startTs: 0, endTs: 8 * 3600 };
// 0–1 h light, 1–2 h deep, 2–3 h REM, 3–3.25 h awake, then light to the end.
const segs = [
  { startTs: 0, endTs: 3600, stage: "light" as const },
  { startTs: 3600, endTs: 7200, stage: "deep" as const },
  { startTs: 7200, endTs: 10800, stage: "rem" as const },
  { startTs: 10800, endTs: 11700, stage: "awake" as const },
  { startTs: 11700, endTs: 8 * 3600, stage: "light" as const },
];
/** One sample every 5 minutes through the night, value = hour of the night (so the window is visible). */
const every5 = Array.from({ length: 96 }, (_, i) => ({ ts: i * 300, ms: 1 + Math.floor((i * 300) / 3600) }));

describe("quietSamples", () => {
  it("keeps only the deep-sleep samples when there are enough", () => {
    const q = quietSamples(every5, night, segs, 3)!;
    expect(q.window).toBe("deep");
    expect(q.samples).toHaveLength(12);
    expect(q.samples.every((s) => s.ts >= 3600 && s.ts < 7200)).toBe(true);
  });
  it("falls back to light and deep sleep (no REM, no awake) with too little deep sleep", () => {
    const q = quietSamples(every5, night, segs, 13)!;
    expect(q.window).toBe("nrem");
    expect(q.samples.some((s) => s.ts >= 7200 && s.ts < 11700)).toBe(false);
  });
  it("falls back to the whole night on an unstaged night", () => {
    const q = quietSamples(every5, night, [], 3)!;
    expect(q.window).toBe("sleep");
    expect(q.samples).toHaveLength(96);
  });
  it("is null with no sample in the night; [start, end) bounds", () => {
    expect(quietSamples([{ ts: night.endTs }], night, segs, 1)).toBeNull();
    expect(quietSamples([{ ts: 3600 }, { ts: 7200 }], night, segs, 1)!.samples).toEqual([{ ts: 3600 }]);
  });
});

describe("geometricMean", () => {
  it("is exp of the mean ln, skipping non-positive values", () => {
    expect(geometricMean([20, 80])).toBeCloseTo(40);
    expect(geometricMean([0, -3, 50])).toBeCloseTo(50);
    expect(geometricMean([])).toBeNull();
  });
});
