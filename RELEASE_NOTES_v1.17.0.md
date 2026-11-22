# Neo v1.17.0 — Release Notes

**Release:** v1.17.0
**Range:** `Release_v1.16.0..HEAD` (25 commits)
**Generated:** 2026-11-22T15:18:26.195Z

This file is generated from Git history and changed-file metadata. Run `npm run release:notes -- <version>` to regenerate it.

## Added

- Add video demonstration to README (`f0b3d25`)
- Addition : Seasonal themes added (`c2571b3`)
- Implementation  :Graphs have been brought back inside the token and request data dashboard (`a4a5122`)
- Christmas themes added and its temporary and will be seen in the new release in december (`844dbdb`)

## Improvements

- Refactor showcase section in README.md (`d9d71d5`)
- UI changes (`59180db`)
- CHristmas themes (`524737d`)

## Fixes

- V1.17.0 finals checks passed with some ui fixes (`54760d1`)
- Fix folder path references and update sidebar components (`7b17f79`)
- Google and github OAUTH seems to be down rn (`472c1f7`)
- CHristmas theme had a bug where it showed all the themes mixed into one :fixed (`01cef0d`)
- Few mistakes regarding the default api url endpoints for individual providers being set to localhost fixed (`d0b11be`)

## Documentation & maintenance

- Update README.md (`c0d8721`)
- Remove Showcase section from README (`4d506b8`)
- Remove struct showcase from README (`b3d4b7d`)
- Showcase: embed video + thumbnail in README (`9e041b7`)
- Update video tag in README.md (`2cbcab8`)

## Other changes

- Showcase: inline GIF + mp4 links (`4d5db28`)
- Showcase: clearer thumbnail + watch-in-browser labels (`388964a`)
- updates to the clip for showcase (`95403ff`)
- Showcase clips (`dc8a8fb`)
- ANimation speed tweaking (`f13d4c9`)
- Giving credits to other opensource tools used inside the app (`6449f77`)
- bumped up the version (`c6e5711`)
- Freellmapi bundled with the appitself for a bigger token usage ceiling (`0e7f80c`)

## Changed files

- `.github/workflows/platform-builds.yml`
- `.gitignore`
- `README.md`
- `components/PromptBar.tsx`
- `components/StatusBar.tsx`
- `electron/freellmapi.cjs`
- `electron/main.cjs`
- `eslint.config.js`
- `licenses/freellmapi-MIT.txt`
- `package-lock.json`
- `package.json`
- `run.sh`
- `scripts/build-freellmapi.mjs`
- `scripts/desktop-build.mjs`
- `src/App.tsx`
- `src/agentic.ts`
- `src/assets/Recording_11_17_2026_4_44_06_PM.mp4`
- `src/assets/showcase-thumbnail.png`
- `src/assets/showcase.gif`
- `src/components/BrowserPreview.tsx`
- `src/components/LoginModal.tsx`
- `src/components/SettingsPanel.tsx`
- `src/components/seasonal/SeasonalEffects.tsx`
- `src/lib/byok.ts`
- `src/locales/en.json`
- `src/main.tsx`
- `src/providers.ts`
- `src/themes/registry.ts`
- `src/themes/seasonal/README.md`
- `src/themes/seasonal/christmas/config.ts`
- `src/themes/seasonal/christmas/theme.css`
- `src/themes/seasonal/fall/FallEffects.tsx`
- `src/themes/seasonal/fall/config.ts`
- `src/themes/seasonal/fall/theme.css`
- `src/themes/seasonal/halloween/HalloweenEffects.tsx`
- `src/themes/seasonal/halloween/config.ts`
- `src/themes/seasonal/halloween/theme.css`
- `src/themes/seasonal/shared/FallingLeaves.tsx`
- `src/themes/seasonal/shared/RisingMotes.tsx`
- `src/themes/seasonal/shared/Snowfall.tsx`
- `src/themes/seasonal/shared/effects.css`
- `src/themes/seasonal/shared/random.ts`
- `src/themes/seasonal/thanksgiving/ThanksgivingEffects.tsx`
- `src/themes/seasonal/thanksgiving/config.ts`
- `src/themes/seasonal/thanksgiving/theme.css`
- `src/themes/seasonal/types.ts`
- `src/types.ts`
- `src/uiSettings.ts`
- `supabase/functions/api-keys/index.ts`
- `supabase/migrations/0004_payments.sql`

## Diff summary

```text
.github/workflows/platform-builds.yml              |    8 +-
 .gitignore                                         |    4 +
 README.md                                          |   29 +-
 components/PromptBar.tsx                           |    7 +
 components/StatusBar.tsx                           |  136 +-
 electron/freellmapi.cjs                            |  125 +
 electron/main.cjs                                  |   45 +-
 eslint.config.js                                   |    2 +-
 licenses/freellmapi-MIT.txt                        |   21 +
 package-lock.json                                  | 5038 +++++++++++++++++++-
 package.json                                       |   53 +-
 run.sh                                             |   17 +
 scripts/build-freellmapi.mjs                       |  128 +
 scripts/desktop-build.mjs                          |   12 +
 src/App.tsx                                        |   72 +-
 src/agentic.ts                                     |   16 +-
 src/assets/Recording_11_17_2026_4_44_06_PM.mp4     |  Bin 0 -> 9944342 bytes
 src/assets/showcase-thumbnail.png                  |  Bin 0 -> 81530 bytes
 src/assets/showcase.gif                            |  Bin 0 -> 7566291 bytes
 src/components/BrowserPreview.tsx                  |   30 +-
 src/components/LoginModal.tsx                      |   32 +-
 src/components/SettingsPanel.tsx                   |  599 ++-
 src/components/seasonal/SeasonalEffects.tsx        |   24 +
 src/lib/byok.ts                                    |    1 +
 src/locales/en.json                                |   13 +
 src/main.tsx                                       |    5 +
 src/providers.ts                                   |   22 +-
 src/themes/registry.ts                             |   58 +
 src/themes/seasonal/README.md                      |   48 +
 src/themes/seasonal/christmas/config.ts            |   10 +
 src/themes/seasonal/christmas/theme.css            |  193 +
 src/themes/seasonal/fall/FallEffects.tsx           |   15 +
 src/themes/seasonal/fall/config.ts                 |   10 +
 src/themes/seasonal/fall/theme.css                 |  113 +
 src/themes/seasonal/halloween/HalloweenEffects.tsx |   76 +
 src/themes/seasonal/halloween/config.ts            |   10 +
 src/themes/seasonal/halloween/theme.css            |  116 +
 src/themes/seasonal/shared/FallingLeaves.tsx       |   98 +
 src/themes/seasonal/shared/RisingMotes.tsx         |   48 +
 src/themes/seasonal/shared/Snowfall.tsx            |   45 +
 src/themes/seasonal/shared/effects.css             |  529 ++
 src/themes/seasonal/shared/random.ts               |    9 +
 .../seasonal/thanksgiving/ThanksgivingEffects.tsx  |   38 +
 src/themes/seasonal/thanksgiving/config.ts         |   10 +
 src/themes/seasonal/thanksgiving/theme.css         |  118 +
 src/themes/seasonal/types.ts                       |   42 +
 src/types.ts                                       |    1 +
 src/uiSettings.ts                                  |   69 +-
 supabase/functions/api-keys/index.ts               |    2 +-
 supabase/migrations/0004_payments.sql              |    3 +
 50 files changed, 7748 insertions(+), 352 deletions(-)
 create mode 100644 electron/freellmapi.cjs
 create mode 100644 licenses/freellmapi-MIT.txt
 create mode 100755 run.sh
 create mode 100644 scripts/build-freellmapi.mjs
 create mode 100644 src/assets/Recording_11_17_2026_4_44_06_PM.mp4
 create mode 100644 src/assets/showcase-thumbnail.png
 create mode 100644 src/assets/showcase.gif
 create mode 100644 src/components/seasonal/SeasonalEffects.tsx
 create mode 100644 src/themes/registry.ts
 create mode 100644 src/themes/seasonal/README.md
 create mode 100644 src/themes/seasonal/christmas/config.ts
 create mode 100644 src/themes/seasonal/christmas/theme.css
 create mode 100644 src/themes/seasonal/fall/FallEffects.tsx
 create mode 100644 src/themes/seasonal/fall/config.ts
 create mode 100644 src/themes/seasonal/fall/theme.css
 create mode 100644 src/themes/seasonal/halloween/HalloweenEffects.tsx
 create mode 100644 src/themes/seasonal/halloween/config.ts
 create mode 100644 src/themes/seasonal/halloween/theme.css
 create mode 100644 src/themes/seasonal/shared/FallingLeaves.tsx
 create mode 100644 src/themes/seasonal/shared/RisingMotes.tsx
 create mode 100644 src/themes/seasonal/shared/Snowfall.tsx
 create mode 100644 src/themes/seasonal/shared/effects.css
 create mode 100644 src/themes/seasonal/shared/random.ts
 create mode 100644 src/themes/seasonal/thanksgiving/ThanksgivingEffects.tsx
 create mode 100644 src/themes/seasonal/thanksgiving/config.ts
 create mode 100644 src/themes/seasonal/thanksgiving/theme.css
 create mode 100644 src/themes/seasonal/types.ts
```

## Uncommitted changes in this build

These files are edited in the working tree, so they are part of the bundled
binaries even though they are outside the commit range above. Commit them
before tagging the release so the tag matches the shipped build:

- `M` `scripts/desktop-build.mjs`

Tracked working-tree diff:

```text
scripts/desktop-build.mjs | 5 +++++
 1 file changed, 5 insertions(+)
```

