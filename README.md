# MC Command Simulator

《我的世界》基岩版（网易中国版）指令的离线模拟器。使用 TypeScript 引擎、React 界面和 Electron 桌面外壳，可以在不进入游戏的情况下编写、运行和测试指令与命令方块链。

## 功能

- 自带脚本语言（`.mcsim`）：声明实体、方块、命令方块链，用 `fill(...)`、`block(..., nbt=...)`、`cb(first_tick=...)` 等语法搭建场景
- 基于 CodeMirror 6 的编辑器：语法高亮、补全、悬停提示、签名提示
- 指令引擎：选择器、`execute`、记分板、FMBE / Molang 等
- `test` 测试块：为脚本编写断言并批量运行
- 结构与 BDX 转换：导入/导出 `.mcstructure` 和 BDX，结构转脚本，实体转命令方块链
- 粒子面板：多视图同时显示，各视图独立控制，支持最大化网格模式
- 命令行模式：不开界面也能运行脚本和测试

## 文档

- [语法教学](docs/语法教学.md)：从入门到命令参考的完整教程
- [示例脚本](examples/demo.mcsim)

## 安装使用

到 [Releases](../../releases) 页面下载：

- `MC Command Simulator Setup x.y.z.exe`：安装版
- `MC Command Simulator x.y.z.exe`：便携版，无需安装

目前只提供 Windows 版本。

## 从源码运行

需要 Node.js（能直接运行 TypeScript 的新版本）和 npm。

```bash
npm install
node node_modules/electron/install.js   # npm 默认跳过安装脚本，需手动下载 Electron
npm run desktop                          # 构建界面并启动桌面应用
```

如果从 GitHub 下载 Electron 很慢，可以先设置镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

PowerShell 中如果 `npm` 被执行策略拦截，请改用 `npm.cmd`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm test` | 运行全部测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run desktop` | 构建并启动桌面应用 |
| `npm run desktop:dir` | 构建免安装目录到 `release/win-unpacked` |
| `npm run desktop:dist` | 打包安装版和便携版到 `release/` |
| `npm run demo` | 用命令行运行示例脚本 |

命令行运行脚本：

```bash
node src/cli.ts examples/demo.mcsim [chain] [--ticks N] [--export commands|manifest]
node src/cli.ts file.mcsim --test            # 运行脚本里的 test 块
node src/cli.ts file.mcsim --test --only a,b # 只运行指定名称的测试
```

## 目录结构

| 目录 | 内容 |
| --- | --- |
| `src/language` | 解析器、语法表、补全、提示、测试块解析 |
| `src/engine` | 世界模型、指令实现、调度器 |
| `src/plugins` | 插件宿主、nx 树生成与校验、粒子面板 |
| `src/nbt`、`src/bdx`、`src/convert` | NBT、BDX、结构转换 |
| `src/ui` | React 界面与编辑器 |
| `electron` | Electron 主进程与预加载脚本 |
| `tests` | 测试用例与夹具 |
| `docs`、`examples`、`design` | 文档、示例、图标源文件 |

## 说明

模拟结果以网易中国版的实际行为为目标。部分行为（如 `/give` 的槽位填充顺序、游戏规则默认值与反馈文本等）来自基岩版的通用知识，尚未在游戏内逐项验证，详见语法教学中的“已验证与未验证行为”。
