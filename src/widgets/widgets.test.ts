// The home-screen widgets' snapshot (what each cell shows) and the live heart-rate updates.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { Profile } from "@/data/types";
import { addDays } from "@/lib/time";
import { runPipeline } from "@/pipeline";
import { loadDays, strainMetric, type QueryCtx } from "@/queries/common";

vi.mock("../../modules/pulse-bt", () => ({ updateWidgets: vi.fn() }));
import { updateWidgets } from "../../modules/pulse-bt";
import { endLiveHeart, publishLiveHeart, publishWidgets } from "./publish";
import { heartCell, widgetSnapshot } from "./snapshot";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
let ctx: QueryCtx;

beforeAll(async () => {
  const store = new MemoryStore();
  await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW });
  await runPipeline(store, PROFILE, { today: TODAY });
  ctx = { store, profile: PROFILE, timeZone: TZ, today: TODAY, now: NOW, sync: { lastSyncTs: NOW, firstDay: addDays(TODAY, -179), lastError: null } };
}, 120_000);

beforeEach(() => vi.mocked(updateWidgets).mockClear());

const sent = () => JSON.parse(vi.mocked(updateWidgets).mock.calls.at(-1)![0]);

describe("widgetSnapshot", () => {
  it("shows today's strain, water and calories eaten as the screens do, and the newest stored heart rate", async () => {
    const s = await widgetSnapshot(ctx);
    const row = (await loadDays(ctx, TODAY, TODAY)).get(TODAY);
    expect(s.day).toBe(TODAY);
    const strain = strainMetric(row).value;
    expect(s.strain.value).toBe(strain == null ? "--" : strain.toFixed(1));
    expect(s.water.caption).toBe("ml");
    expect(s.calories.caption).toBe("kcal");
    expect(s.heart.value).toMatch(/^\d+$/);
    expect(s.heart.caption).toMatch(/^bpm · \d{2}:\d{2}$/);
  });

  it("dashes a cell without data", () => {
    expect(heartCell(null)).toMatchObject({ value: "--", caption: "bpm" });
  });
});

describe("live heart rate", () => {
  it("replaces only the heart cell, at most every 10 s, and drops the Live tag when the link ends", async () => {
    await publishWidgets(ctx);
    const full = sent();
    const t = Date.now();
    publishLiveHeart(97, t, TZ);
    expect(sent().heart).toMatchObject({ value: "97" });
    expect(sent().heart.caption).toMatch(/Live$/);
    expect(sent().strain).toEqual(full.strain);
    publishLiveHeart(120, t + 3_000, TZ);
    expect(sent().heart.value).toBe("97");
    publishLiveHeart(121, t + 11_000, TZ);
    expect(sent().heart.value).toBe("121");
    endLiveHeart(TZ);
    expect(sent().heart.value).toBe("121");
    expect(sent().heart.caption).toMatch(/^bpm · \d{2}:\d{2}$/);
  });
});
