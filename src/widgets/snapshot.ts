// What the two home-screen widgets show (modules/pulse-bt/…/PulseWidgets.kt): heart rate beside today's strain, and
// today's water beside today's calories eaten. Everything is formatted here, in the person's language and units, so the
// native side only lays out text.
import { i18n } from "@/i18n/config";
import { clock, FORMATS } from "@/lib/format";
import { metricLabel } from "@/lib/metricLabels";
import { quantity } from "@/lib/units";
import { loadDays, strainMetric, type QueryCtx } from "@/queries/common";

/** One half of a widget: a label, the value, and a small line under it (unit, time); `value` is "--" without data. */
export type WidgetCell = { label: string; value: string; caption: string };

export type WidgetSnapshot = {
  /** The local day the daily cells belong to; the widget blanks them once the phone's date moves past it. */
  day: string;
  heart: WidgetCell;
  strain: WidgetCell;
  water: WidgetCell;
  calories: WidgetCell;
};

const NONE = "--";

/** A heart-rate reading: live from the band (Pulse open and streaming), or the newest one stored. */
export type HeartReading = { bpm: number; at: number; live: boolean };

export function heartCell(hr: HeartReading | null, timeZone?: string): WidgetCell {
  const label = i18n.t("health:title.heartRate");
  if (!hr) return { label, value: NONE, caption: "bpm" };
  return { label, value: FORMATS.int(hr.bpm), caption: hr.live ? `bpm · ${i18n.t("more:group.live")}` : `bpm · ${clock(hr.at, timeZone)}` };
}

/** The newest heart rate Pulse has stored (from Health Connect), whenever it was. */
export async function storedHeart(ctx: QueryCtx): Promise<HeartReading | null> {
  const bounds = await ctx.store.hrBounds();
  if (!bounds) return null;
  const last = (await ctx.store.readHr(bounds.last, bounds.last + 1)).at(-1);
  return last ? { bpm: last.bpm, at: last.ts * 1000, live: false } : null;
}

export async function widgetSnapshot(ctx: QueryCtx, heart?: HeartReading | null): Promise<WidgetSnapshot> {
  const day = ctx.today;
  const [rows, hr] = await Promise.all([loadDays(ctx, day, day), heart === undefined ? storedHeart(ctx) : Promise.resolve(heart)]);
  const row = rows.get(day);
  const strain = strainMetric(row).value;
  const water = row?.extra.water;
  const kcal = row?.extra.calories_in;
  const ml = quantity("ml");
  return {
    day,
    heart: heartCell(hr, ctx.timeZone),
    strain: { label: metricLabel("strain"), value: strain == null ? NONE : FORMATS.decimal1(strain), caption: "0–21" },
    water: { label: metricLabel("water"), value: water == null ? NONE : FORMATS.grouped(ml.value(water)), caption: ml.unit },
    calories: { label: metricLabel("calories_in"), value: kcal == null ? NONE : FORMATS.grouped(kcal), caption: "kcal" },
  };
}
