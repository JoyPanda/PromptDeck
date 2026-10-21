<div align="center">
  <img src="assets/PromptDeck.png" width="96" alt="PromptDeck 图标">

  # PromptDeck

  **简洁 · 本地 · 可同步** 的原生提示词模板工具<br>
  TypeScript + GPUIX · Windows / macOS

  <p>
    <a href="https://github.com/JoyPanda/PromptDeck/releases"><img src="https://img.shields.io/github/downloads/JoyPanda/PromptDeck/total?style=for-the-badge&label=%E4%B8%8B%E8%BD%BD&color=F97316&logo=github&logoColor=white" alt="下载"></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript">
    <img src="https://img.shields.io/badge/GPUIX-0.10.0-237a55?style=flat" alt="GPUIX 0.10.0">
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-007EC6?style=flat" alt="Windows / macOS">
  </p>

  <strong>中文</strong> · <a href="README_EN.md">English</a>
</div>

## 核心功能

- **模板与槽位**：用 `{{变量名}}` 写出提示词。槽位可以是单行文本、多行文本、下拉、数字和是否。
- **使用、历史、编辑**：填好槽位后生成并复制。每个模板保留生成记录，也可以在左侧打开全部历史。
- **整理**：收藏、标签和分类都留在模板里，侧栏按这些条件查看。
- **仓库同步**：用 GitHub 或 GitLab 同步模板。比较修改时间，较新的内容留下；删除会写成墓碑。生成记录只留在本机。
- **外观与快捷键**：跟随系统、浅色或深色，可改字体和字号。全局快捷键把窗口叫回前面。关闭窗口时也可以收进托盘。
- **版本更新**：大约每天检查一次 GitHub Release。发现新版本后可以在窗口里下载、校验并安装。

## 下载与使用

从 [GitHub Releases](https://github.com/JoyPanda/PromptDeck/releases) 下载安装。默认呼出键是 macOS `⇧⌘Space`、Windows `Shift+Ctrl+Space`。

- **macOS**：未签名的安装包首次打开时，需要在「系统设置 → 隐私与安全性」里允许打开。
- **Windows**：未签名的安装包可能触发 SmartScreen，选择「更多信息」→「仍要运行」。安装不需要管理员权限。

## 从源码运行

安装 [Bun](https://bun.sh) 后：

```bash
git clone https://github.com/JoyPanda/PromptDeck.git
cd PromptDeck
bun install
bun run dev
```

当前系统的安装包：

```bash
bun run package
```

Windows 打包需要先安装 Inno Setup 6。发布步骤见 [docs/release.md](docs/release.md)。

## 贡献

感谢每一位贡献者！

<a href="https://github.com/JoyPanda/PromptDeck/graphs/contributors">贡献者</a>

<p align="center">
  <a href="https://github.com/JoyPanda/PromptDeck/issues"><img src="https://img.shields.io/badge/贡献与反馈-237a55?style=flat&logo=github&logoColor=white" alt="贡献与反馈" height="24"></a>
  <a href="RELEASES.md"><img src="https://img.shields.io/badge/更新日志-237a55?style=flat&logo=readthedocs&logoColor=white" alt="更新日志" height="24"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/MIT%20License-237a55?style=flat&logo=opensourceinitiative&logoColor=white" alt="MIT License" height="24"></a>
</p>
