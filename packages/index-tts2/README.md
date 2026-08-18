# tinkerdesk-tool-index-tts2

TinkerDesk 外置工具：**index_tts** —— 调用本机 **IndexTTS2（IndexTTS-2.5）** 生成克隆语音（[IndexTTS](https://github.com/index-tts/index-tts) 零样本 TTS：一段参考音频即克隆音色，支持中/英/日/西/阿五语）。由 tinkerdesk-tools monorepo CI 自动发布。

- 完整工具形态（Agent 自主调用、全参数）：`dist/index.js` 导出 `{ schema, execute }`
- 参数：文本 / 语言 / 语速（durationFactor 0.5-2.0）/ 情感（音频参考 or 8 向量预设）/ 文本归一化 / 分段静音 / 随机采样 / BF16 / 输出路径 / 参考音色
- spawn 本机 Python 执行 `scripts/gen_index.py`（项目根 `C:\tools\index-tts` 在 PYTHONPATH——官方源码仓库 + modelscope 模型）

## 安装（重要）

本工具依赖本机 IndexTTS 运行环境（Python 3.10 + 官方源码 + 模型权重 `checkpoints/gpt.pth` ~3.26G）。安装前请先阅读 **[install.md](./install.md)**——三步完成：检查 python → 官方命令安装（conda/uv + 模型下载）→ 版本跟随策略。

## 构建

源码为 TypeScript，发布/加载入口为 tsc 编译产物 `dist/`：

```bash
npm install         # 安装 devDependencies（typescript + @types/node）
npm run build       # tsc -p tsconfig.json → dist/（ES2022 + CommonJS + strict + declaration）
npm run verify      # node verify.test.js（结构 + 校验层测试）
```

执行 `execute` 时以 `dist/index.js` 为准——修改 `src/` 后需重新 `npm run build`。

## 协议

```
manifest: { id: "index-tts2", entry: "dist/index.js", apiVersion: 1, kind: "tool", tool: { name: "index_tts", ... } }
dist/index.js: module.exports = { schema, execute }（tsc 编译输出）
execute(toolCall) → { ok: true, output: { filePath, wavPath } } | { ok: false, error }
```

## 参数表（全部可选，除 text 必填）

| 参数 | 类型 | 默认 | 说明 |
| :--- | :--- | :--- | :--- |
| `text` | string | **必填** | 要合成的文本内容 |
| `lang` | string | `ZH` | 合成语言：`ZH` 中文 / `EN` 英文 / `JA` 日文 / `ES` 西班牙文 / `AR` 阿拉伯文 |
| `durationFactor` | number | `1.0` | 语速/时长系数 `0.5-2.0`——>1 更慢 <1 更快（speed 的倒数，如 2.0 为 0.5 倍速） |
| `emotionMode` | string | `none` | 情感控制方式：`none` 同音色 / `audio` 情感参考音频 / `preset`（同 `vector`）情感向量预设 |
| `emoAudioPrompt` | string | — | 情感参考音频路径（wav/mp3——`emotionMode=audio` 时生效） |
| `emotionPreset` | string | — | 情感预设（`emotionMode=preset/vector` 时生效）：`happy` `angry` `sad` `afraid` `disgusted` `melancholic` `surprised` `calm` |
| `emoAlpha` | number | `1.0` | 情感强度 `0-2` |
| `textNormalization` | boolean | `true` | 文本归一化（数字/日期转口语——拼音/CMU 音素/日文假名） |
| `intervalSilence` | number | `200` | 长文本分段间隔静音毫秒 |
| `useRandom` | boolean | `false` | 随机采样（增强表现力——降低克隆保真度） |
| `useBf16` | boolean | `true` | BF16 半精度推理（省显存） |
| `outputPath` | string | 自动 | 输出 wav 路径；空则自动生成到系统临时目录并返回该路径 |
| `refAudio` | string | 配置 | 参考音色 wav/mp3 路径（5-10 秒清晰人声）；空则用环境变量 `INDEX_TTS_VOICE_PROFILE` |

## 运行环境（环境变量可覆盖）

| 环境变量 | 默认 | 用途 |
| :--- | :--- | :--- |
| `INDEX_TTS_DIR` | `C:\tools\index-tts` | IndexTTS 项目根（Gen 脚本 cwd + PYTHONPATH） |
| `INDEX_TTS_VENV_PYTHON` | 项目 `.venv` | Python 解释器路径 |
| `INDEX_TTS_VOICE_PROFILE` | — | 默认参考音色（`refAudio` 参数优先） |

## 目录

```
scripts/gen_index.py          IndexTTS-2.5 合成脚本（stdin JSON → stdout JSON，spawn 调用，原样复用插件版本）
src/index.ts                  工具入口（schema + execute + 参数校验 + spawn python）
src/lib/schema.ts             工具 schema + 常量（五语/8 情感/区间 clamp）+ 校验辅助
dist/                         构建产物（tsc 编译——发布与加载入口 dist/index.js）
tsconfig.json                 ES2022 + CommonJS + strict + declaration，outDir=dist
manifest.json                 工具清单（kind: tool, tool.name: index_tts）
install.md                    IndexTTS 本机环境安装说明（python 检查 → 官方命令 → 版本跟随）
```