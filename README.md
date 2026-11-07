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
