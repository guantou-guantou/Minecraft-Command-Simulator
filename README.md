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
- [游戏内验证清单](docs/游戏内验证清单.md):还没有在游戏里核对的行为,以及怎么测
- [路线图](docs/路线图.md):下一版和更远的计划
- [示例脚本](examples/demo.mcsim)

## 安装使用

到 [Releases](../../releases) 页面下载：

- `MC Command Simulator Setup x.y.z.exe`：安装版
- `MC Command Simulator x.y.z.exe`：便携版，无需安装

目前只提供 Windows 版本。

## 系统要求

- **Windows 10 及以上**(64 位)。不支持 Windows 7、8、8.1:桌面外壳使用的 Electron 版本已不再支持这些系统,在上面无法启动。
- 安装包没有代码签名,首次运行时 Windows SmartScreen 可能会提示"未知发布者",选择"更多信息 → 仍要运行"即可。

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
| `npm run cli:build` | 生成单文件命令行工具 `dist-cli/mcsim.mjs` |

命令行(适合自动化和让 AI agent 使用,文件名写 `-` 表示从标准输入读脚本):

```bash
node src/cli.ts check  file.mcsim [--json]    # 只检查不运行,输出和编辑器一致的诊断
node src/cli.ts run    file.mcsim [chain...] [--all] [--ticks N] [--command "/cmd"] [--state] [--json]
node src/cli.ts test   file.mcsim [--only a,b] [--json]
node src/cli.ts export file.mcsim [chain...] [--all] [--format commands|manifest]
npm run cli:build                             # 生成单文件 dist-cli/mcsim.mjs,只需要 Node 就能运行
```

退出码:0 一切正常;1 有诊断、指令报错或测试失败;2 用法错误或找不到文件。测试里的 `/指令` 步骤执行失败也算测试失败。旧的 `node src/cli.ts file.mcsim [chain] [--ticks N] [--test]` 写法仍然可用。详见语法教学第 11 章。

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

## 许可证

[MIT](LICENSE)

## 说明

模拟结果以网易中国版的实际行为为目标。部分行为（如 `/give` 的槽位填充顺序、游戏规则默认值与反馈文本等）来自基岩版的通用知识，尚未在游戏内逐项验证，详见语法教学中的“已验证与未验证行为”。
