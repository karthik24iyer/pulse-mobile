// Settings › Profile › Photo. The web crops in the browser and stores a 512 px WebP in Postgres (pulse
// src/lib/crop.ts, src/server/avatar.ts); here the system picker crops a square, expo-image-manipulator shrinks it to a
// 256 px JPEG, and it lives in the app's own document directory. Only the file URI goes in the profile; the photo never
// leaves the phone. Each photo gets a new name, so an Image showing the old one never serves it from its cache.
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync, type ImagePickerOptions } from "expo-image-picker";

const dir = () => new Directory(Paths.document, "avatar");

const PICK: ImagePickerOptions = { mediaTypes: "images", allowsEditing: true, aspect: [1, 1], quality: 1 };

/** Takes or picks a photo, square-cropped, and saves it at 256 px. Null when cancelled; throws when the camera is refused. */
export async function pickPhoto(from: "camera" | "library"): Promise<string | null> {
  if (from === "camera" && !(await requestCameraPermissionsAsync()).granted) throw new Error("camera_denied");
  const r = from === "camera" ? await launchCameraAsync(PICK) : await launchImageLibraryAsync(PICK);
  if (r.canceled || !r.assets[0]) return null;
  const image = await ImageManipulator.manipulate(r.assets[0].uri).resize({ width: 256, height: null }).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const d = dir();
  d.create({ idempotent: true, intermediates: true });
  const out = new File(d, `${Date.now()}.jpg`);
  await new File(saved.uri).move(out);
  return out.uri;
}

/** Deletes one saved photo; a file already gone is fine. */
export function deletePhoto(uri: string) {
  try {
    new File(uri).delete();
  } catch {}
}

/** The saved photo as base64, for a backup (Pulse+); null when it is gone or unreadable. */
export async function photoBase64(uri: string): Promise<string | null> {
  try {
    const f = new File(uri);
    return f.exists ? await f.base64() : null;
  } catch {
    return null;
  }
}

/** Saves a photo from a backup (base64 JPEG) under a new name; its URI, or null when it can't be written. */
export function savePhotoBase64(data: string): string | null {
  try {
    const d = dir();
    d.create({ idempotent: true, intermediates: true });
    const out = new File(d, `${Date.now()}.jpg`);
    out.create({ overwrite: true });
    out.write(data, { encoding: "base64" });
    return out.uri;
  } catch {
    return null;
  }
}

/** Deletes every saved photo (Delete everything). */
export function deleteAllPhotos() {
  try {
    if (dir().exists) dir().delete();
  } catch {}
}
