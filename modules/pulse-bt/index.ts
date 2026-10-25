// Pulse's small native helper (android/…/PulseBtModule.kt): the Bluetooth LE devices paired with the phone, and opening
// another app. Both are safe to call anywhere: without the native module (tests, web) they return nothing.
import { requireOptionalNativeModule } from "expo";

export type HealthFeatures = { skinTemperature: boolean; history: boolean; background: boolean };
type Native = {
  bondedDevices(): { id: string; name: string | null }[];
  openApp(pkg: string): boolean;
  healthFeatures(): HealthFeatures | null;
  updateWidgets(json: string): void;
};
const native = requireOptionalNativeModule<Native>("PulseBt");

/** LE devices paired with this phone, as { id: Bluetooth address, name }. */
export function bondedDevices(): { id: string; name: string | null }[] {
  try {
    return native?.bondedDevices() ?? [];
  } catch {
    return [];
  }
}

/** Opens the app with this package; false when it isn't installed or can't open. */
export function openApp(pkg: string): boolean {
  try {
    return native?.openApp(pkg) ?? false;
  } catch {
    return false;
  }
}

/** Feature-gated Health Connect data this phone can serve; null when unknown (no native module or no Health Connect). */
export function healthFeatures(): HealthFeatures | null {
  try {
    return native?.healthFeatures() ?? null;
  } catch {
    return null;
  }
}

/** Saves the widgets' snapshot (src/widgets/snapshot.ts, as JSON) and redraws every placed Pulse widget. */
export function updateWidgets(json: string): void {
  try {
    native?.updateWidgets(json);
  } catch {
    // No widget placed, or no native module: nothing to draw.
  }
}
