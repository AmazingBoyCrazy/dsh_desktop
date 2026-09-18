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
7. **内置增强插件机制保留、本版本暂不随包**：插件通过官方 `dsh.profile.bundles` 机制挂载（写入 web profile 的 `package.json`，仅当不存在时；与 `dsh plugin add` 一致，绝不写 `cordis.patch.yml` 行，避免双挂载 duplicate 崩溃）。清单由 `src/main/harness.mjs` 的 `BUNDLED_PLUGINS` 驱动，当前为空（原因见"内置插件"一节）：第三方插件生态仍以 `0.1.5-rc` 引擎线为 peer 目标，混挂会导致引擎启动失败。
8. **修复引擎 token 门禁下的白屏**：`0.1.6-alpha` 线的网页界面要求"进程级浏览器会话令牌"，裸访问回环地址会返回 401。桌面壳改为解析引擎打印的 `dsh web: http://127.0.0.1:<port>/?token=…` 就绪行，窗口按该 URL 加载（令牌一次性换取 Cookie），此前会白屏。
9. **补全打包裁剪的引擎依赖**：electron-builder 按依赖图收集 `node_modules`，会漏掉仅以 peer 边存在的引擎包（`dsh-jobs`、`dsh-settings`、`dsh-attachment`、`dsh-session-persistence` 等 13 个），打包版启动即 `ERR_MODULE_NOT_FOUND`。这些包已在 `package.json` 显式声明。

## 工作原理

桌面壳（Electron 主进程）以 `ELECTRON_RUN_AS_NODE=1` 方式把内嵌引擎（`@deepseek-ai/dsh` 的 `dsh web` 配置档）作为子进程拉起，等引擎打印带令牌的就绪行后，窗口加载该 URL（引擎的网页界面在 `0.1.6-alpha` 线要求进程级令牌，裸回环地址返回 401）。引擎只监听 `127.0.0.1`，会话、设置、插件全部存放在 `~/.dsh`，与 CLI 完全共享。

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

## 内置插件

**本版本（`0.1.6-alpha.2` 引擎线）不随包附带任何第三方插件**：插件生态当前仍以 `0.1.5-rc` 引擎为 peer 目标，版本不匹配会让引擎启动直接失败（fail-loud），因此优先保证"装了就能开"。首次启动只挂载引擎自带的 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 两个 bundle（由引擎自身初始化 profile，桌面壳不再写 seed）。

- **想要增强插件**：等对应插件支持本条引擎线后，用插件市场 UI 或 `dsh plugin --profile web add <包名>` 安装——两者都走官方 `dsh.profile.bundles` 机制。
- **重新随包内置**：把包名填进 `src/main/harness.mjs` 的 `BUNDLED_PLUGINS`（空数组即"不内置"），profile 清单与依赖列表都由它派生；同时把包名加回 `package.json` 的 `dependencies`，否则打包后解析不到。
- **禁用/卸载插件**：用插件市场 UI 或 `dsh plugin --profile web remove <包名>`。**不要手改 `cordis.patch.yml` 的插件行**——官方 bundle 挂载与手写行同时存在会触发 `duplicate loader entry id` 崩溃（本仓库早期版本踩过这个坑）。

## 从源码开发

需要 Node.js ≥ 22.12：

```sh
git clone https://github.com/AmazingBoyCrazy/dsh_desktop.git
cd dsh_desktop
npm ci
npm start
```

常用脚本：`npm start`（开发模式）、`npm run smoke`（引擎冒烟）、`npm run dist`（打包）、`npm run check:upstream`（检查上游引擎版本）。

开发模式注意：

- `npm start` 与已安装的桌面版**共用同一个 `userData` 目录与单实例锁**，已安装版本正在运行时开发模式会直接退出（表现为"点了没反应"）。先完全退出已安装版本，或换一份数据目录：`npx electron . --user-data-dir=<某空目录>`。
- **Electron 版本必须精确等于 `44.0.0`**：引擎通过 `node-addon-require-builtin` 读取 Node 内部模块（配置档解析需要），该原生模块只支持精确指纹（`43.0.0`、`44.0.0`、`45.0.0-alpha.6`），换成 `43.4.0`、`^44` 等都会让引擎启动即失败（`Unsupported/no-context`）。上游官方桌面版同样固定在 Electron 44。
- 在 DSH 引擎里开的终端会继承 `ELECTRON_RUN_AS_NODE=1`，此时 `npm start` 会把 Electron 当纯 Node 跑并报 `does not provide an export named 'Menu'`；在普通终端里运行，或先 `Remove-Item Env:\ELECTRON_RUN_AS_NODE`。

## 自动发版

`release.yml` 每日定时检查 npm 官方仓库：上游 `@deepseek-ai/dsh` 发布新版本后自动固定版本、构建三平台安装包并发布 GitHub Release，全程无需人工介入。手动触发：Actions → Release → Run workflow。

## 已知限制

- **安装包未签名**（macOS Gatekeeper / Windows SmartScreen 提示；代码签名在路线图中）。
- **Electron 版本被引擎钉死**：必须精确 `44.0.0`（原生模块指纹限制），因此不能在发版前随意升级 Electron；升级前请确认目标版本出现在 `node-addon-native-custom-loader` 的支持列表里。
- **本版不内置第三方插件**（生态尚未跟上 `0.1.6-alpha` 引擎线），需自行从插件市场安装。
- **Windows 退出时引擎为硬终止**：Windows 不支持 SIGTERM 优雅停机，退出应用可能丢失少量未落盘会话数据（上游 CLI 在 POSIX 下无此问题）。
- **应用内自动更新依赖网络**：更新检查走 GitHub，被代理/网络环境拦截时（表现为日志中 SSL 握手失败）请手动下载安装包。
- 引擎继承上游运行要求（shell 工具需要宿主机具备 PowerShell 等）。

## 许可证

MIT — 见 [LICENSE](LICENSE)。引擎上游：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）。
