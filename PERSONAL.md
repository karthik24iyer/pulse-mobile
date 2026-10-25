# Pulse+ (personal build)

This branch (`personal`) is a personal, noncommercial copy of [Pulse Mobile](https://github.com/adityaongit/pulse-mobile)
under its PolyForm Noncommercial license. It installs as its own app, **Pulse+** (`in.portlabs.pulse.personal`),
alongside the original.

## What's different from upstream

- Back goes back a screen instead of closing the app (predictive back off; tab Back follows history).
- The "needs more permissions" warning ignores data types this phone's Health Connect doesn't offer (skin temperature,
  past data on older versions).
- Health Monitor counts only the vitals it has readings for, and shows SpO2 when some app writes it.
- Blood pressure (systolic and diastolic) from Health Connect.
- Two 2x1 home-screen widgets: heart rate + today's strain, today's water + calories eaten.
- No "update available" prompts for upstream APKs (they can't install over this package).
- Recovery reads HRV and heart rate from deep sleep (falling back to light and deep, then the whole night), judges HRV
  on a log scale, and scores both through a ±0.5 SD normal band against your last 30 nights (see the commit message
  for the research behind it).
- Backup and restore (More › Your data › Backup): everything you enter yourself in one JSON file. Restoring merges and
  never deletes, and also reads the Journal JSON export from Pulse Mobile.

## Get the APK

Every push to `personal` builds the APK on GitHub (`.github/workflows/apk.yml`, about 15–20 minutes). Download it from
the [pulse-plus-latest release](https://github.com/karthik24iyer/pulse-mobile/releases/tag/pulse-plus-latest) (open
it on the phone and tap the `.apk`), or from the run's Artifacts in the Actions tab.

## Build an APK (Linux)

Needs Node 20+, pnpm, JDK 17+ and the Android SDK (`ANDROID_HOME` set; Android Studio installs it).

```sh
pnpm install                     # runs install scripts too (Skia's native libraries come from one)
npx expo prebuild -p android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# → android/app/build/outputs/apk/release/app-release.apk
```

The release build is signed with Expo's template debug key, so every APK built this way installs as an update over
the last one and keeps the app's data. On a machine with 8 GB of RAM or less, add `--max-workers=1` and
`-Dorg.gradle.jvmargs=-Xmx3g` if Gradle gets killed.

## Updating

```sh
git pull
pnpm install
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Run `npx expo prebuild -p android --clean` again after a change to `app.json` or to native modules (the backup
feature added `expo-document-picker`, so the first build after it needs this).
