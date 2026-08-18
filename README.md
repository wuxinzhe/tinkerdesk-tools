# tinkerdesk-tools

TinkerDesk 工具 monorepo —— **单仓库维护所有外置工具包**。每个工具独立 npm 包（保留独立发布端），CI 自动发布。

## 结构

```
packages/
└── computer-use   → tinkerdesk-tool-computer-use
```

## 新增工具

```bash
mkdir packages/<name>
# 放入工具源码（manifest/scripts/index.*/package.json）
# 推送 main → CI 自动 npm publish
```

## 发布

单仓库 + CI 自动拆包发布：检测 `packages/*` 任一目录变更 → 基于 npm 已发布 latest +1 → `npm publish`（独立包名生态保留）。

## 规范

- 包名 `tinkerdesk-tool-<name>`
- 每个包独立 `package.json`（含 scripts/依赖）+ 工具 manifest
- keywords 含 `tinkerdesk-tool` + 分类词（工具市场按此检索）
