# tinkerdesk-tool-computer-use

TinkerDesk 外置工具：**computer use** —— 截屏 + 鼠标/键盘/拖拽 + 应用窗口 + 浏览器自动化控制计算机桌面（基于 [cua-driver](https://cua.ai/cua-driver)，trycua/cua 开源 Rust 驱动）。

- 完整工具形态（不经 provider 接口）：`dist/index.js` 导出 `{ schema, execute }`
- 单工具 + action 判别（23 类动作：capture/click/type/key/scroll/drag/focus_app/cua_browser_* 等）
- 内建安全门检：危险按键组合（锁屏/登出/清空废纸篓等）拒绝、危险 type 文本（`curl|bash`/`sudo rm -rf`/fork bomb 等）拒绝

## 安装（重要）

本工具依赖外置组件 **cua-driver**（Rust 二进制）。安装前请先阅读 **[install.md](./install.md)**——按步骤检查/安装 cua-driver（含版本跟随策略：锁定 cua-driver ≥ 0.13.0）。

## 构建

源码为 TypeScript，发布/加载入口为 tsc 编译产物 `dist/`：

```bash
npm install         # 安装 devDependencies（typescript + @types/node）
npm run build       # tsc -p tsconfig.json → dist/（ES2022 + CommonJS + strict + declaration）
```

执行 `execute` 时以 `dist/index.js` 为准——修改 `src/` 后需重新 `npm run build`。

## 协议

```
manifest: { id: "computer-use", entry: "dist/index.js", apiVersion: 1, kind: "tool", tool: { name: "computer_use", ... } }
dist/index.js: module.exports = { schema, execute }（tsc 编译输出）
execute(toolCall) → { ok: boolean, output?: string, error?: string }
```

## 目录

```
src/index.ts                 工具入口（schema + execute + action 分发 + 安全门检）
src/lib/schema.ts            23 action 常量 + ComputerUseAction 类型 + 安全规则（危险按键/危险文本）
src/lib/cua-driver-client.ts STDIO MCP 客户端（查找 cua-driver 可执行 + JSON-RPC 通信）
dist/                        构建产物（tsc 编译——发布与加载入口 dist/index.js）
tsconfig.json                ES2022 + CommonJS + strict + declaration，outDir=dist
manifest.json                工具清单（entry: dist/index.js）
install.md                   外置组件 cua-driver 安装说明
```