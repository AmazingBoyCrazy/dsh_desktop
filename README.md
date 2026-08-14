# DeepSeek Harness Desktop

[![CI](https://github.com/AmazingBoyCrazy/dsh_desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/AmazingBoyCrazy/dsh_desktop/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/AmazingBoyCrazy/dsh_desktop?include_prereleases&label=release)](https://github.com/AmazingBoyCrazy/dsh_desktop/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**DeepSeek Harness Desktop** 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的桌面客户端：不需要终端、不需要安装 Node.js、也不需要 `dsh web` 命令。双击图标，完整的 DeepSeek Harness 网页版界面就会在自己的窗口里打开。

## 项目来源与维护说明

- **引擎**：内嵌官方 npm 包 `@deepseek-ai/dsh`（DeepSeek 官方发布，版本精确锁定），升级完全跟随官方，与 CLI 共用同一数据目录 `~/.dsh`。
- **桌面壳**：基于 [deepseek-harness-desktop](https://github.com/hongfeiyucode/deepseek-harness-desktop)（MIT）起步，原作者版权与署名保留（见 [LICENSE](LICENSE)）。本仓库在此之上独立维护，后续不再依赖第三方桌面壳，更新来源以 DeepSeek 官方引擎为准。

## 本仓库相对原始壳的改进

1. **修复应用内自动更新**（Windows/Linux）：原始版 `latest*.yml` 指向不存在的文件（404），自动更新必然失败；本仓库显式指定 `artifactName`，更新元数据与实际产物一致，已实测 200 OK。
2. **修复 Windows 终端弹窗**：引擎与沙箱 runner 均为无控制台进程，执行命令时 Windows 会为每个子进程弹出可见终端窗口。本仓库在引擎与 runner 两层实现"隐藏控制台"方案（引擎 `AllocConsole + SW_HIDE`，runner 通过 `--import` 预加载补丁并 `AttachConsole` 共享引擎控制台），全链路命令执行不再产生任何窗口；普通子进程另有 `windowsHide` 自适应兜底。
3. **修复 Windows 沙箱命令 100% 失败**：桌面版工作区为用户主目录，而 ACL 沙箱要求临时目录在工作区之外；引擎的 TMP/TEMP 已重定向到 `C:\Users\Public\dsh-desktop-tmp`，沙箱命令恢复可用。
4. **新增 Windows CI**：引擎冒烟、真实 Electron 桌面冒烟、控制台补丁探针、runner 注入形状测试，全部在 Windows runner 上执行（原始壳仅 Linux CI）。
5. **依赖显式化**：补丁依赖的 `@deepseek-ai/dsh-host-directory-picker` 显式声明，不再依赖 npm 提升（hoisting）。
6. **鲸鱼图标**：窗口/任务栏/dock 图标替换为 DeepSeek Harness 官方鲸鱼 Logo。

## 工作原理

桌面壳（Electron 主进程）以 `ELECTRON_RUN_AS_NODE=1` 方式把内嵌引擎（`@deepseek-ai/dsh` 的 `dsh web` 配置档）作为子进程拉起，等待其在回环地址就绪后，窗口加载引擎提供的官方网页界面。引擎只监听 `127.0.0.1`，会话、设置、插件全部存放在 `~/.dsh`，与 CLI 完全共享。

```
桌面壳（Electron）──守护──▶ 引擎子进程（Electron Node 24）
     │                            │ 提供网页界面 127.0.0.1:32123
     └──窗口（沙箱渲染进程）◀────┘ 会话/设置/插件 ⇄ ~/.dsh（与 CLI 共享）
```

## 安装使用

从 [Releases](https://github.com/AmazingBoyCrazy/dsh_desktop/releases) 下载对应平台安装包：

| 平台 | 安装包 |
| --- | --- |
| Windows 10/11（x64） | `deepseek-harness-desktop-<版本>-x64.exe`（NSIS 安装程序） |
| macOS（Apple Silicon / Intel） | `*-arm64.dmg` / `*-x64.dmg` |
| Linux（x64） | `*-x86_64.AppImage` 或 `*.deb` |

- 未签名：Windows SmartScreen 提示时点 *更多信息 → 仍要运行*；macOS 首次打开请右键 *打开*。
- 安装后双击图标即用，首次启动需几秒初始化。
- **数据共享**：默认使用 `~/.dsh`（与 CLI/网页版共享会话、设置、凭据）。同一时间只运行一个引擎（桌面版或 `dsh web` 二选一），避免并发写冲突。

## 配置

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | harness 数据目录，原样透传引擎 |
| `DSH_DESKTOP_PORT` | `32123,32124,32125` | 引擎回环端口候选（逗号分隔） |
| `DSH_DESKTOP_PATCH_DEBUG` | 未设置 | `1` 时输出控制台补丁诊断日志到引擎日志 |

## 从源码开发

需要 Node.js ≥ 22.12：

```sh
git clone https://github.com/AmazingBoyCrazy/dsh_desktop.git
cd dsh_desktop
npm ci
npm start
```

常用脚本：`npm start`（开发模式）、`npm run smoke`（引擎冒烟）、`npm run dist`（打包）、`npm run check:upstream`（检查上游引擎版本）。

## 自动发版

`release.yml` 每日定时检查 npm 官方仓库：上游 `@deepseek-ai/dsh` 发布新版本后自动固定版本、构建三平台安装包并发布 GitHub Release，全程无需人工介入。手动触发：Actions → Release → Run workflow。

## 已知限制

- **安装包未签名**（macOS Gatekeeper / Windows SmartScreen 提示；代码签名在路线图中）。
- **Windows 退出时引擎为硬终止**：Windows 不支持 SIGTERM 优雅停机，退出应用可能丢失少量未落盘会话数据（上游 CLI 在 POSIX 下无此问题）。
- **应用内自动更新依赖网络**：更新检查走 GitHub，被代理/网络环境拦截时（表现为日志中 SSL 握手失败）请手动下载安装包。
- 引擎继承上游运行要求（shell 工具需要宿主机具备 PowerShell 等）。

## 许可证

MIT — 见 [LICENSE](LICENSE)。引擎上游：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）。
