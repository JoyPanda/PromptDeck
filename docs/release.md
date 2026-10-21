# PromptDeck 发布流程

**中文** · [English](release_EN.md)

当前版本写在 `package.json` 的 `version`。发布标签是 `v` 加这个版本，例如 `0.9.1` 对应 `v0.9.1`。

工作流不会创建或推送标签。标签必须已经存在，并且指向要发布的那一次提交。Release 以草稿创建，说明由 GitHub 根据提交记录生成。已有同名 Release 时，只补传还没有的安装包，不覆盖已有文件和说明。

日常推送到 `main` / `master` 以及 pull request 只跑 `.github/workflows/build.yml`：安装依赖、`bun test`、`bun run typecheck`。这个工作流不打包。

## 发一次版本

1. 修改 `package.json` 的 `version`，提交并推送。
2. 在该提交上打标签并推送。版本号必须是 `v主.次.修`，可以带预发布后缀，例如 `v0.9.1` 或 `v0.9.1-beta.1`。

   ```bash
   git tag v0.9.1
   git push origin v0.9.1
   ```

3. 推送 `v*.*.*` 标签会触发 `.github/workflows/build-release.yml`。也可以在 Actions 里手动运行 **Build and Release**。手动运行时，版本号留空就用 `package.json`；填写的版本必须和 `package.json` 一致，标签必须已经在远端，并且指向这次检出的提交。
4. 工作流先创建草稿 Release，标题是 `PromptDeck v0.9.1`。然后三个平台并行测试、打包、上传。
5. 到仓库的 Releases 页面检查草稿和安装包，确认后手动公开。工作流不会把草稿改成已发布。

标签和 `package.json` 不一致时，工作流会失败。本地 `bun run release` 在工作区有未提交修改、标签不存在、或标签不指向当前提交时也会停下来。

## 安装包名称

| 平台 | 已签名 | 未签名 |
| --- | --- | --- |
| macOS arm64 | `PromptDeck-0.9.1-macOS-arm64.dmg` | `PromptDeck-0.9.1-macOS-arm64-unsigned.dmg` |
| Windows x64 | `PromptDeck-0.9.1-Windows-Setup.exe` | `PromptDeck-0.9.1-Windows-Setup-unsigned.exe` |
| Linux x64 | `PromptDeck-0.9.1-linux.AppImage` | 同左，不另加后缀 |

GPUIX 0.10 只提供这三个原生模块：macOS arm64、Windows x64、Linux x64。发布只打这三份安装包。

## macOS arm64

运行环境是 `macos-latest`。顺序是：检出、安装依赖、`bun test`、`bun run typecheck`、打包。

`bun run package` 会先编译出 `dist/PromptDeck`，再做成 `dist/PromptDeck.app`。包名是 `app.promptdeck.desktop`，最低系统版本是 macOS 13。然后做一份磁盘映像：卷名 PromptDeck，里面是 `PromptDeck.app` 和指向 `/Applications` 的替身，格式是 UDZO。

五个密钥都存在时走签名：

- `MAC_CSC_LINK`：Developer ID 证书，base64 的 `.p12`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

签名时设置 `PROMPTDECK_SIGNED=1`。脚本把证书导入临时钥匙串，用 Developer ID 对应用做 hardened runtime 和时间戳签名，生成 dmg 后再签 dmg，然后 `notarytool submit --wait` 并 `stapler staple`。完成后用 `codesign --verify --deep --strict` 和 `xcrun stapler validate` 检查。文件名不带 `-unsigned`。

缺任何一个密钥就打未签名包：应用只做 ad-hoc 签名（`codesign --sign -`），dmg 不公证。文件名带 `-unsigned`。用户需要在访达里右键应用并选择「打开」。

上传时如果草稿里已经有同名 dmg，就跳过。

本机在 Apple 芯片 Mac 上执行 `bun run package`，产物是 `dist/PromptDeck-0.9.1-macOS-arm64-unsigned.dmg`。要在本机打已签名包，先导出上述五个环境变量和 `PROMPTDECK_SIGNED=1`，再执行 `bun run package`。

## Windows x64

运行环境是 `windows-latest`。顺序是：检出、安装依赖、`bun test`、`bun run typecheck`、用 Chocolatey 安装 Inno Setup 6、打包。

`bun run package` 编译出 `dist/PromptDeck.exe`，再调用 `ISCC.exe` 打安装包。安装程序按当前用户安装，不要求管理员。目录是 `%LOCALAPPDATA%\Programs\PromptDeck`，并创建开始菜单和桌面快捷方式。这一步的文件名是 `PromptDeck-0.9.1-Windows-Setup.exe`。

四个 SignPath 密钥都存在时签名：

- `SIGNPATH_API_TOKEN`
- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_SIGNING_POLICY_SLUG`

未签名的 exe 先作为 Actions artifact 上传，再交给 `signpath/github-action-submit-signing-request@v2`，最多等待 3600 秒。签完后检查 Authenticode。通过后，以 `PromptDeck-0.9.1-Windows-Setup.exe` 上传到 Release。

缺任何一个密钥就不签名，把文件改名为 `PromptDeck-0.9.1-Windows-Setup-unsigned.exe` 再上传。安装时 Windows SmartScreen 会提示，需要选择「更多信息」→「仍要运行」。

同名文件已在 Release 里就跳过。

本机需要先安装 Inno Setup 6，再在 Windows x64 上执行 `bun run package`。`bun run release` 在没有 `PROMPTDECK_SIGNED=1` 时，会先把 exe 改成 `-unsigned` 再上传。

## Linux x64

运行环境是 `ubuntu-latest`。顺序是：检出、安装依赖、`bun test`、`bun run typecheck`、安装 `libfuse2`（没有这个包时安装 `libfuse2t64`）、打包。

`bun run package` 编译出 `dist/PromptDeck`，组装 AppDir：`AppRun`、`PromptDeck.desktop`、`PromptDeck.png`，以及 `usr/bin/PromptDeck`。然后下载 `appimagetool-x86_64.AppImage`，以 `APPIMAGE_EXTRACT_AND_RUN=1` 打出 `PromptDeck-0.9.1-linux.AppImage`。这份文件不签名，也没有 `-unsigned` 后缀。

同名文件已在 Release 里就跳过。

本机在 Linux x64 上执行 `bun run package` 会得到同一份 AppImage。需要能访问 GitHub 以下载 appimagetool，并具备 `libfuse2` 或改用提取运行。

## 本机补传

三个平台的安装包由对应系统上的 GitHub Actions 上传。本机只能补当前系统的那一份：

```bash
bun run package
bun run release
```

`bun run release` 要求工作区干净，并且 `v` 加 `package.json` 版本的标签已经指向当前提交。它不会创建或推送标签。Release 不存在时，用 `gh release create` 建草稿并生成说明；已存在时只上传缺失的安装包。本机需要已登录的 `gh`。

只打包、不上传时，加 `--no-build` 会跳过编译，直接使用 `dist` 里已有的 dmg、exe 或 AppImage：

```bash
bun run release -- --no-build
```

## 密钥一览

仓库 Settings → Secrets and variables → Actions：

| 平台 | 密钥 | 作用 |
| --- | --- | --- |
| macOS | `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` | Developer ID 签名和公证 |
| Windows | `SIGNPATH_API_TOKEN`、`SIGNPATH_ORGANIZATION_ID`、`SIGNPATH_PROJECT_SLUG`、`SIGNPATH_SIGNING_POLICY_SLUG` | SignPath Authenticode 签名 |

五件或四件必须齐套。缺一件就发布对应平台的未签名安装包。Linux 不使用签名密钥。
