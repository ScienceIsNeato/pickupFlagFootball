# Android (Google Play) — Trusted Web Activity

The Play Store app is not a second codebase. It's a ~2 MB shell that opens
pickupflagfootball.com full-screen in the user's own Chrome, with the URL bar
removed. Ship the website, and the app ships with it — no store review for
content changes, no version skew, no separate release train.

The only things that make it an *app* rather than a bookmark are the Digital
Asset Links handshake (below) and the Play listing.

## The one decision you can't undo

**`packageId` is permanent.** It's currently `com.pickupflagfootball.app`
(`android/twa-manifest.json`). Once an artifact with that ID is uploaded to
Play, that ID is bound to this listing forever — it can't be renamed, and it
can never be reused by another app on any account. It's also public, in the
store URL: `play.google.com/store/apps/details?id=com.pickupflagfootball.app`.

`.app` rather than `.twa` on purpose: if this ever becomes a native or hybrid
app, the ID still describes it. Change it **before** the first upload or not at
all.

## Prerequisites

- JDK 17 (`brew install openjdk@17`)
- Android SDK with `platforms;android-35` + `build-tools;36.1.0`
  (36.1.0 specifically — Bubblewrap 1.25 pins that exact version and will try to
  install it itself if it's missing, which is a worse path; see the `tools`
  symlink note below)
- Bubblewrap: `npm i -g @bubblewrap/cli`
- `~/.bubblewrap/config.json` pointing at both:
  ```json
  {
    "jdkPath": "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk",
    "androidSdkPath": "/Users/you/android-sdk"
  }
  ```
  `jdkPath` is the `.jdk` bundle, **not** its `Contents/Home` — Bubblewrap
  appends `Contents/Home` itself, and pointing at the usual `JAVA_HOME` gets you
  `.../Contents/Home/Contents/Home` and an "invalid directory" build failure.
  Bubblewrap looks for `sdkmanager` under `<sdk>/tools/bin` (the pre-2021
  layout), which `cmdline-tools/latest` doesn't provide. Symlink the whole
  directory, not just its `bin`:
  ```bash
  ln -sfn ~/android-sdk/cmdline-tools/latest ~/android-sdk/tools
  ```
  Symlinking only `bin` gets further and then fails worse: `sdkmanager` resolves
  its own libraries and the SDK root relative to its parent, so it lands on
  "Could not determine SDK root". Linking the whole directory keeps both its
  `lib/` and the legacy root detection intact.

## The keystore is a credential

`android/android.keystore` is the **upload key**. It is gitignored and must stay
that way. Its password is at `~/.pff-android-keys/upload-keystore-password.txt`
(mode 600) — back both up somewhere durable that isn't this laptop.

Losing the upload key is recoverable (Play support can reset it). This is only
true because Play App Signing holds the *real* signing key on Google's side —
keep that enabled, and the worst case stays "annoying" rather than "this listing
is permanently unpublishable".

## Build

```bash
cd android
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/android-sdk
PW=$(cat ~/.pff-android-keys/upload-keystore-password.txt)
BUBBLEWRAP_KEYSTORE_PASSWORD="$PW" BUBBLEWRAP_KEY_PASSWORD="$PW" \
  bubblewrap build --skipPwaValidation
```

Produces `app-release-bundle.aab` (upload this) and `app-release-signed.apk`
(sideload for local testing).

Only `android/twa-manifest.json` is source — the Gradle project is regenerated
by `bubblewrap update`, so don't hand-edit anything else in `android/`.

Bump `appVersionCode` (integer, must strictly increase on every upload) and
`appVersion` (the human "1.0.0") in `twa-manifest.json` for each release.

The version-name key really is **`appVersion`**, not the `appVersionName` you'd
expect from the field name Bubblewrap uses internally. Getting it wrong is quiet
and nasty: the build succeeds, and you only find out when `aapt2 dump badging`
shows `versionName=''` or Play rejects the upload. Check it after building:

```bash
~/android-sdk/build-tools/36.1.0/aapt2 dump badging android/app-release-signed.apk | head -1
```

## Digital Asset Links — the step that decides if it looks like an app

Chrome only drops the URL bar if the site vouches for the app's signing
certificate. Without it you ship a browser window with a visible address bar,
which looks exactly like the "repackaged website" the store is suspicious of.

This is served from `/.well-known/assetlinks.json`, rewritten to
`app/api/assetlinks/route.ts` and driven by env vars, because the fingerprint
doesn't exist until after the first upload:

1. Upload the AAB to Play Console (internal testing is enough).
2. **Release → Setup → App signing** → copy the SHA-256 of the *App signing key
   certificate*. Also copy the *Upload key certificate* SHA-256.
3. Set on the prod Cloud Run service:
   ```
   TWA_PACKAGE_NAME=com.pickupflagfootball.app
   TWA_SHA256_FINGERPRINTS=<app-signing-sha256>,<upload-key-sha256>
   ```
   Both, not just the first: installs from Play are signed with Google's key,
   while an APK you sideload is signed with the upload key. List only one and
   the other build shows a URL bar and looks broken.
4. Verify: `curl https://pickupflagfootball.com/.well-known/assetlinks.json`
5. Reinstall the app. No URL bar ⇒ verified.

The endpoint 404s until both env vars are set — deliberately. An assetlinks file
that parses but names nobody reads as "we checked, and that app is not ours".

## Store listing

Needs, beyond the binary:

- **Privacy policy URL** — https://pickupflagfootball.com/privacy ✅
- **Data safety form** — declare honestly: email address (account), approximate
  location/ZIP (matching you to nearby games), display name. Collected, tied to
  identity, not sold, not shared. It is worth being scrupulous here; the form is
  enforced and the app's whole pitch is that it's not creepy about location.
- **Content rating questionnaire** — user-generated content (game chat) has to be
  declared, which typically lands it above "Everyone".
- **Screenshots** — min 2 phone screenshots. `npm run demo:shots` and the
  simulator captures produce these.
- **Feature graphic** — 1024×500 PNG.
- **App icon** — 512×512 (`public/pwa/icon-512.png`).

## Timeline gate

A Play developer account registered as an **individual** after Nov 2023 must run
a closed test with **12+ testers for 14 continuous days** before it can apply for
production access. Organization accounts are exempt. Check which one this is
before promising a launch date — if it applies, the clock starts when the closed
test does, so open it early even if the listing isn't polished.

## iOS

Not attempted, deliberately. Apple's Guideline 4.2 (Minimum Functionality)
rejects apps that are "simply a repackaged website", and a WKWebView wrapper of
this site is that. Clearing it realistically means native push notifications and
native location — a real project, and $99/year — so it's worth doing only once
Play tells us people actually install this thing.
