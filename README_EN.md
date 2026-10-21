<div align="center">
  <img src="assets/PromptDeck.png" width="96" alt="PromptDeck icon">

  # PromptDeck

  A **simple, local, syncable** native prompt-template app<br>
  TypeScript + GPUIX · Windows / macOS

  <p>
    <a href="https://github.com/JoyPanda/PromptDeck/releases"><img src="https://img.shields.io/github/downloads/JoyPanda/PromptDeck/total?style=for-the-badge&label=Download&color=F97316&logo=github&logoColor=white" alt="Download"></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript">
    <img src="https://img.shields.io/badge/GPUIX-0.10.0-237a55?style=flat" alt="GPUIX 0.10.0">
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-007EC6?style=flat" alt="Windows / macOS">
  </p>

  <a href="README.md">中文</a> · <strong>English</strong>
</div>

## Features

- **Templates and slots**: write prompts with `{{name}}` placeholders. Slots can be single-line text, multiline text, a dropdown, a number, or yes/no.
- **Use, history, edit**: fill the slots, generate the prompt, and copy it. Each template keeps its generation history, and the sidebar can show every history entry.
- **Organization**: favorites, tags, and categories stay on the template and can be filtered in the sidebar.
- **Repository sync**: sync templates with GitHub or GitLab. Newer edits win, and deletions are recorded as tombstones. Generation history stays on this computer.
- **Appearance and hotkey**: follow the system theme, or choose light or dark, and change the font and size. A global hotkey brings the window forward. Closing the window can also hide it in the tray.
- **Updates**: PromptDeck checks GitHub Releases about once a day. A new version can be downloaded, verified, and installed from inside the app.

## Download and use

Download an installer from [GitHub Releases](https://github.com/JoyPanda/PromptDeck/releases). The default hotkey is `⇧⌘Space` on macOS and `Shift+Ctrl+Space` on Windows.

- **macOS**: an unsigned build must be allowed in **System Settings → Privacy & Security** the first time it opens.
- **Windows**: an unsigned installer may show SmartScreen. Choose **More info → Run anyway**. Installation does not require an administrator.

## Run from source

Install [Bun](https://bun.sh), then run:

```bash
git clone https://github.com/JoyPanda/PromptDeck.git
cd PromptDeck
bun install
bun run dev
```

Package an installer for the current system:

```bash
bun run package
```

Windows packaging needs Inno Setup 6. The release steps are in [docs/release_EN.md](docs/release_EN.md).

## Contributing

Thanks to everyone who contributes.

<a href="https://github.com/JoyPanda/PromptDeck/graphs/contributors">Contributors</a>

<p align="center">
  <a href="https://github.com/JoyPanda/PromptDeck/issues"><img src="https://img.shields.io/badge/Issues-237a55?style=flat&logo=github&logoColor=white" alt="Issues" height="24"></a>
  <a href="RELEASES.md"><img src="https://img.shields.io/badge/Changelog-237a55?style=flat&logo=readthedocs&logoColor=white" alt="Changelog" height="24"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/MIT%20License-237a55?style=flat&logo=opensourceinitiative&logoColor=white" alt="MIT License" height="24"></a>
</p>
