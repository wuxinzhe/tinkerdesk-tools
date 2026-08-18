# tinkerdesk-tool-computer-use

TinkerDesk 外置工具：**computer use** —— 截屏 + 鼠标/键盘/拖拽 + 应用窗口 + 浏览器自动化控制计算机桌面（基于 [cua-driver](https://cua.ai/cua-driver)，trycua/cua 开源 Rust 驱动）。

- 完整工具形态（不经 provider 接口）：`index.js` 导出 `{ schema, execute }`
- 单工具 + action 判别（23 类动作：capture/click/type/key/scroll/drag/focus_app/cua_browser_* 等）
- 内建安全门检：危险按键组合（锁屏/登出/清空废纸篓等）拒绝、危险 type 文本（`curl|bash`/`sudo rm -rf`/fork bomb 等）拒绝

## 安装（重要）

本工具依赖外置组件 **cua-driver**（Rust 二进制）。安装前请先阅读 **[install.md](./install.md)**——按步骤检查/安装 cua-driver（含版本跟随策略：锁定 cua-driver ≥ 0.13.0）。

## 协议

```
manifest: { id: "computer-use", entry: "index.js", apiVersion: 1, kind: "tool", tool: { name: "computer_use", ... } }
index.js: module.exports = { schema, execute }
execute(toolCall) → { ok: boolean, output?: string, error?: string }
```

## 目录

```
index.js                 工具入口（schema + execute + action 分发 + 安全门检）
lib/schema.js            24 action 常量 + 安全规则（危险按键/危险文本）
lib/cua-driver-client.js STDIO MCP 客户端（查找 cua-driver 可执行 + JSON-RPC 通信）
install.md               外置组件 cua-driver 安装说明
```