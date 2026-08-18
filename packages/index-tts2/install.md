# install.md — index_tts 工具安装说明

本工具（`index_tts`）依赖**本机 IndexTTS2（IndexTTS-2.5）运行环境**：项目源码（`indextts` 是项目内模块，不是 pip 包）、Python 3.10 环境、官方模型权重（`checkpoints/gpt.pth` ~3.26G + `config.yaml`）。安装完成前请依次完成下面三步。

> 官方文档（随时以官方为准）：
> - 项目仓库：https://github.com/index-tts/index-tts（docs/README_zh.md）
> - 模型：ModelScope https://modelscope.cn/models/IndexTeam/IndexTTS-2.5 ｜ HuggingFace https://huggingface.co/IndexTeam/IndexTTS-2.5

---

## 第 1 步：检查本机环境

```bash
python --version       # 或 python3 --version / py -V（Windows）
git --version          # 克隆 IndexTTS 源码需要
uv --version           # 官方推荐的依赖管理工具（可选，官方方式用）
```

- ✅ Python **3.10+** 且 git 可用 → 直接跳到**第 2 步**
- ❌ Python 版本不符 → 用 conda 创建 3.10 环境（见第 2 步方式 B）
- ❌ 命令不存在 → 先安装：[Python 3.10](https://www.python.org/downloads/) / [git](https://git-scm.com/downloads) / [Anaconda 或 Miniconda](https://docs.conda.io/en/latest/miniconda.html)

> 本工具对应 IndexTTS 版本：**IndexTTS-2.5**（`indextts.infer_v2_5.IndexTTS2` + `checkpoints/config.yaml` + `checkpoints/gpt.pth`）。Gen 脚本需要项目根在 `PYTHONPATH`——项目必须装在约定位置（默认 `C:\tools\index-tts`，环境变量 `INDEX_TTS_DIR` 可覆盖）。建议 NVIDIA GPU（CUDA 12.8+，显存 ≥ 8G；`use_bf16` 可显著降低显存占用）。

---

## 第 2 步：安装 IndexTTS（官方命令）

### 方式 A：官方推荐（uv，自动管理 Python 版本与依赖）

```bash
# ① 克隆官方源码到项目根（Gen 脚本从项目根 import indextts——目录名必须是 index-tts）
git clone https://github.com/index-tts/index-tts.git C:\tools\index-tts
cd C:\tools\index-tts

# ② 安装并同步依赖（自动创建 .venv 虚拟环境 + 正确版本 Python）
pip install -U uv
uv sync --all-extras
# 下载缓慢可换国内镜像：
# uv sync --all-extras --default-index "https://mirrors.aliyun.com/pypi/simple"

# ③ 下载模型（IndexTTS-2.5 → 项目根 checkpoints/）
uv tool install "modelscope"        # 或 uv tool install "huggingface-hub"
modelscope download --model IndexTeam/IndexTTS-2.5 --local_dir checkpoints
# 或 HuggingFace：
# hf download IndexTeam/IndexTTS-2.5 --local-dir=checkpoints
```

### 方式 B：conda + pip（Python 3.10 显式环境）

```bash
# ① 创建 Python 3.10 环境
conda create -n indextts python=3.10 -y
conda activate indextts

# ② 克隆官方源码到项目根（目录名必须是 index-tts）
git clone https://github.com/index-tts/index-tts.git C:\tools\index-tts
cd C:\tools\index-tts

# ③ 安装依赖（按官方当前 requirements 清单，含 torch——CUDA 版 torch 见 pytorch.org 按本机 CUDA 选择）
pip install -U pip
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
pip install modelscope    # 或用 huggingface_hub

# ④ 下载模型（IndexTTS-2.5 → 项目根 checkpoints/）
modelscope download --model IndexTeam/IndexTTS-2.5 --local_dir checkpoints
```

> 若用 conda/系统 python 方式运行，请确保执行时激活了该环境（或把环境 python 的完整路径配给工具：环境变量 `INDEX_TTS_VENV_PYTHON`，如 `C:\tools\index-tts\.venv\Scripts\python.exe`）。

### 验证模型就绪

```bash
ls C:\tools\index-tts\checkpoints\config.yaml C:\tools\index-tts\checkpoints\gpt.pth
```

> 两个文件都存在即就绪（`gpt.pth` ~3.26G——IndexTTS-2.5 模型权重）。

---

## 第 3 步：版本跟随策略（重要）

- 本工具按 **IndexTTS-2.5**（IndexTTS-2 模型的 2.5 版本线）的推理 API 开发：`indextts.infer_v2_5.IndexTTS2` + `checkpoints/config.yaml` + `checkpoints/gpt.pth`。**跟着官方版本走**——安装时使用官方当前最新 release 的依赖清单（`uv sync` 或 `requirements.txt`）。
- 即使本 install.md 没来得及更新，只要满足**Python 3.10 环境 + 官方模型在项目根 `checkpoints/`**，工具即可用。
- 官方发布新版本（IndexTTS-2.5 小版本升级）时，工具无需改动；若官方做破坏性升级（如推理 API 变更、模型结构变更），本文件会随工具包更新到新的安装要求。
- 工具运行时按环境变量解析环境：`INDEX_TTS_DIR`（项目根，默认 `C:\tools\index-tts`）/ `INDEX_TTS_VENV_PYTHON`（python 路径，默认项目 `.venv`）/ `INDEX_TTS_VOICE_PROFILE`（默认参考音色）。

**装好模型后：重启 TinkerDesk（或重新加载工具），即可调用 `index_tts` 工具生成语音。**