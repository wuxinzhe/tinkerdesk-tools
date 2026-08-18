# install.md — computer-use 工具安装说明

本工具（`computer_use`）依赖**外置组件 cua-driver**（trycua/cua，开源 Rust computer-use 驱动，macOS/Windows/Linux，通过 MCP/stdio 与桌面交互）。安装本工具前必须先把 cua-driver 装好。

---

## 第 1 步：检查本机是否已装 cua-driver

```bash
cua-driver --version
```

- ✅ 输出 `cua-driver 0.xx.x` → 已安装，直接跳到**第 3 步**
- ❌ 提示命令不存在 → 继续**第 2 步**安装

> 本工具对应 cua-driver 版本：**≥ 0.13.0**（见第 3 步版本跟随策略）。

---

## 第 2 步：安装 cua-driver（官方文档：https://cua.ai/docs/how-to-guides/driver/install）

cua-driver 官方提供一行安装脚本，macOS/Windows/Linux 通用（无需管理员权限）。

**Windows 10/11（PowerShell）**
```powershell
irm https://cua.ai/driver/install.ps1 | iex
cua-driver autostart kick
```
> 安装到 `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin` 并加入用户 PATH。

**macOS 14+**
```bash
/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"
```

**Linux（x86_64 + X11/XWayland）**
```bash
sudo apt install libxi6 at-spi2-core
/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"
```

**验证安装**
```bash
cua-driver --version
cua-driver doctor   # Linux 额外检查 AT-SPI/显示服务
```

---

## 第 3 步：版本跟随策略（重要）

TinkerDesk 的 computer-use 外置工具**锁定对应 cua-driver 的特定版本**（当前要求 **≥ 0.13.0**）：

- 我们的工具按 cua-driver 0.13.x 的 MCP/stdio 协议开发，**跟着 cua-driver 版本走**；
- 即使本 install.md 没来得及更新，只要本机 cua-driver 是 **0.13.x 主版本**，工具即可用；
- 官方发布新版本时，工具只要求最低版本（语义化主版本内兼容），不要求升级；
- 若 cua-driver 做破坏性升级（跨主版本），本文件会随工具包更新到新的最低版本要求。

**执行安装/升级后**：重启 TinkerDesk（或重新加载工具），`computer_use` 即可工作。