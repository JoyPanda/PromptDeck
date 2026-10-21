[中文](release.md) · **English**

# PromptDeck release process

The current version is `version` in `package.json`. The release tag is `v` plus that version, so `0.9.1` becomes `v0.9.1`.

The workflow does not create or push the tag. The tag must already exist and point at the commit being released. The Release is created as a draft, and GitHub generates the notes from the commit history. If a Release with the same name already exists, only missing installers are uploaded. Existing files and notes are left as they are.

Pushes to `main` / `master`, and pull requests, only run `.github/workflows/build.yml`: install dependencies, `bun test`, and `bun run typecheck`. That workflow does not package the app.

## Ship a version

1. Change `version` in `package.json`, commit, and push.
2. Tag that commit and push the tag. The version must be `vMAJOR.MINOR.PATCH`, with an optional prerelease suffix, for example `v0.9.1` or `v0.9.1-beta.1`.

   ```bash
   git tag v0.9.1
   git push origin v0.9.1
   ```

3. Pushing a `v*.*.*` tag starts `.github/workflows/build-release.yml`. You can also run **Build and Release** by hand from Actions. Leave the version blank to use `package.json`. A version you type must match `package.json`. The tag must already be on the remote and must point at the checked-out commit.
4. The workflow creates a draft Release titled `PromptDeck v0.9.1`. The three platforms then test, package, and upload in parallel.
5. Check the draft and the installers on the repository Releases page, then publish it yourself. The workflow does not turn the draft into a published release.

The workflow fails when the tag and `package.json` disagree. Local `bun run release` also stops when the worktree has uncommitted changes, the tag is missing, or the tag does not point at the current commit.

## Installer names

| Platform | Signed | Unsigned |
| --- | --- | --- |
| macOS arm64 | `PromptDeck-0.9.1-macOS-arm64.dmg` | `PromptDeck-0.9.1-macOS-arm64-unsigned.dmg` |
| Windows x64 | `PromptDeck-0.9.1-Windows-Setup.exe` | `PromptDeck-0.9.1-Windows-Setup-unsigned.exe` |
| Linux x64 | `PromptDeck-0.9.1-linux.AppImage` | Same name; no extra suffix |

GPUIX 0.10 provides only these three native modules: macOS arm64, Windows x64, and Linux x64. A release builds those three installers.

## macOS arm64

The runner is `macos-latest`. The order is: checkout, install dependencies, `bun test`, `bun run typecheck`, then package.

`bun run package` compiles `dist/PromptDeck`, then builds `dist/PromptDeck.app`. The bundle id is `app.promptdeck.desktop`, and the minimum system version is macOS 13. It then creates a disk image named PromptDeck, containing `PromptDeck.app` and an alias to `/Applications`, in UDZO format.

Signing runs when all five secrets are present:

- `MAC_CSC_LINK`: the Developer ID certificate, a base64 `.p12`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Signing sets `PROMPTDECK_SIGNED=1`. The script imports the certificate into a temporary keychain, signs the app with Developer ID, the hardened runtime, and a timestamp, signs the dmg, then runs `notarytool submit --wait` and `stapler staple`. It checks the result with `codesign --verify --deep --strict` and `xcrun stapler validate`. The file name has no `-unsigned` suffix.

If any secret is missing, the build stays unsigned: the app gets an ad-hoc signature (`codesign --sign -`), and the dmg is not notarized. The file name includes `-unsigned`. The user opens it from Finder with Control-click and **Open**.

Upload skips a dmg that is already on the draft.

On an Apple silicon Mac, `bun run package` produces `dist/PromptDeck-0.9.1-macOS-arm64-unsigned.dmg`. To sign locally, export the five environment variables and `PROMPTDECK_SIGNED=1`, then run `bun run package`.

## Windows x64

The runner is `windows-latest`. The order is: checkout, install dependencies, `bun test`, `bun run typecheck`, install Inno Setup 6 with Chocolatey, then package.

`bun run package` compiles `dist/PromptDeck.exe`, then calls `ISCC.exe`. The installer is per-user and does not require an administrator. It installs to `%LOCALAPPDATA%\Programs\PromptDeck` and creates Start menu and desktop shortcuts. The file at this step is `PromptDeck-0.9.1-Windows-Setup.exe`.

Signing runs when all four SignPath secrets are present:

- `SIGNPATH_API_TOKEN`
- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_SIGNING_POLICY_SLUG`

The unsigned exe is uploaded as an Actions artifact, then sent to `signpath/github-action-submit-signing-request@v2`, waiting up to 3600 seconds. After Authenticode verification it is uploaded to the Release as `PromptDeck-0.9.1-Windows-Setup.exe`.

If any secret is missing, the file is renamed to `PromptDeck-0.9.1-Windows-Setup-unsigned.exe` and uploaded. Windows SmartScreen warns during install; choose **More info** → **Run anyway**.

A file that is already on the Release is skipped.

Locally, install Inno Setup 6, then run `bun run package` on Windows x64. Without `PROMPTDECK_SIGNED=1`, `bun run release` renames the exe to `-unsigned` before upload.

## Linux x64

The runner is `ubuntu-latest`. The order is: checkout, install dependencies, `bun test`, `bun run typecheck`, install `libfuse2` (or `libfuse2t64` when that package is absent), then package.

`bun run package` compiles `dist/PromptDeck` and assembles an AppDir: `AppRun`, `PromptDeck.desktop`, `PromptDeck.png`, and `usr/bin/PromptDeck`. It downloads `appimagetool-x86_64.AppImage` and, with `APPIMAGE_EXTRACT_AND_RUN=1`, produces `PromptDeck-0.9.1-linux.AppImage`. That file is unsigned and has no `-unsigned` suffix.

A file that is already on the Release is skipped.

On Linux x64, `bun run package` produces the same AppImage. The machine needs access to GitHub to download appimagetool, and either `libfuse2` or extract-and-run.

## Upload the current platform locally

GitHub Actions on each platform uploads that platform's installer. A local machine can only add the installer for its own system:

```bash
bun run package
bun run release
```

`bun run release` requires a clean worktree, and the tag `v` plus the `package.json` version must already point at the current commit. It does not create or push the tag. If the Release does not exist, it uses `gh release create` to make a draft and generate notes. If it exists, it uploads only the missing installers. The machine needs a signed-in `gh`.

To upload without compiling, `--no-build` skips the build and uses the dmg, exe, or AppImage already in `dist`:

```bash
bun run release -- --no-build
```

## Secrets

Repository Settings → Secrets and variables → Actions:

| Platform | Secrets | Purpose |
| --- | --- | --- |
| macOS | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Developer ID signing and notarization |
| Windows | `SIGNPATH_API_TOKEN`, `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG` | SignPath Authenticode signing |

The five macOS secrets, or the four Windows secrets, must all be present. If one is missing, that platform ships an unsigned installer. Linux does not use signing secrets.
