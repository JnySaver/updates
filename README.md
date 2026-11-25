# JnySaver updates

Where JnySaver for Windows and Android get their updates. Nothing here needs touching by hand.

- **Releases** hold the installers: `JnySaver-Setup-<version>.exe` (Windows) and `JnySaver-<version>.apk` (Android).
- **latest.json** says which versions are newest. **latest.json.sig** is its signature: the apps only accept a
  `latest.json` signed with JnySaver's update key, and only installers whose SHA-256 matches it. So a changed file here
  can't push a fake update.
- **instagram/** holds the Instagram reader. A newer one reaches both apps without reinstalling.

## Installing for the first time

- **Windows:** download the newest `JnySaver-Setup-….exe` from Releases and open it (if Windows warns, choose
  *More info → Run anyway*).
- **Android:** download the newest `JnySaver-….apk` from Releases on the phone and open it.

After that, both apps update themselves.

## How a release gets here

The private project pushes a branch called `incoming` with the files and a signed `latest.json`.
`.github/workflows/publish.yml` turns it into GitHub releases, moves `latest.json`, its signature and the reader onto
`main`, and deletes `incoming`.

## JnyCam (camera app for Moto phones)

- **Install or reinstall (for example after a phone reset):** on the phone, open
  https://github.com/JnySaver/updates/releases/download/jnycam/JnyCam.apk and install it.
  That link always gives the newest version.
- After that, JnyCam updates itself (it checks on its own, or tap ⓘ → *Check for updates*).
- `jnycam/latest.json` and `jnycam/latest.json.sig` work like JnySaver's: the app only accepts a `latest.json` signed
  with JnyCam's own update key, and only installs an APK whose SHA-256 matches it.
- Releases: `jnycam` (always the newest, as `JnyCam.apk`) and `jnycam-<version>` (one per version).
