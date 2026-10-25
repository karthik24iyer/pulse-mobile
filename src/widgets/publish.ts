// Pushes a fresh snapshot to the home-screen widgets: after every sync (app or background task), whenever the app's data
// changes (a water or food log), and while live heart rate streams. Never throws; without the native module (tests,
// web) it does nothing.
import { updateWidgets } from "../../modules/pulse-bt";
import type { Profile } from "@/data/types";
import { localDay } from "@/lib/time";
import type { QueryCtx } from "@/queries/common";
import type { Store } from "@/data/store";
import { heartCell, widgetSnapshot, type HeartReading, type WidgetSnapshot } from "./snapshot";

let last: WidgetSnapshot | null = null;

function push(s: WidgetSnapshot) {
  last = s;
  updateWidgets(JSON.stringify(s));
}

/** Recomputes everything from the Store and updates both widgets. */
export async function publishWidgets(ctx: QueryCtx, heart?: HeartReading | null): Promise<void> {
  try {
    push(await widgetSnapshot(ctx, heart));
  } catch (e) {
    console.warn("[widgets]", e instanceof Error ? e.message : String(e));
  }
}

/** For runs outside the screens (the sync, the background task): a context from the Store and profile alone. */
export async function publishFromStore(store: Store, profile: Profile): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const sync = await store.getSyncState();
    await publishWidgets({ store, profile, timeZone: profile.timeZone, today: localDay(now, profile.timeZone), now, sync });
  } catch (e) {
    console.warn("[widgets]", e instanceof Error ? e.message : String(e));
  }
}

const LIVE_EVERY_MS = 10_000;
let lastLive = 0;

/**
 * Live heart rate from the band: only the heart cell changes, at most every 10 s (each update redraws the widget;
 * Android coalesces faster ones anyway). The daily cells keep the last full snapshot's values.
 */
let liveReading: HeartReading | null = null;

export function publishLiveHeart(bpm: number, at: number, timeZone?: string): void {
  liveReading = { bpm, at, live: true };
  if (!last || at - lastLive < LIVE_EVERY_MS) return;
  lastLive = at;
  try {
    push({ ...last, heart: heartCell({ bpm, at, live: true }, timeZone) });
  } catch {
    // The widget keeps what it had.
  }
}

/** The live link ended: the heart cell keeps the last live reading, now with its time instead of "Live". */
export function endLiveHeart(timeZone?: string): void {
  const r = liveReading;
  liveReading = null;
  lastLive = 0;
  if (!last || !r) return;
  try {
    push({ ...last, heart: heartCell({ ...r, live: false }, timeZone) });
  } catch {
    // The widget keeps what it had.
  }
}
