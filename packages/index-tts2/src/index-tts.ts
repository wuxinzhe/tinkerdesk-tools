/**
 * index-tts.ts — index_tts 外置工具（实现 IAgentTool，与内建工具同构）
 *
 * 调用本机 IndexTTS2（IndexTTS-2.5）生成克隆语音——Agent 自主调用、全参数。
 * 自包含 Node 模块——不依赖 TinkerDesk 内部类，仅用标准库（child_process/os/path/fs）。
 *
 * 出口：export class IndexTTS——实现 getSchema/execute/check（IAgentTool 契约）。
 * 类型定义归位 ./types.ts。
 *
 * 运行环境（参考 plugins/packages/index-tts2 的 spawn 链）：
 *   - 项目根：默认 C:\tools\index-tts（import indextts 需要项目根在 PYTHONPATH），
 *     环境变量 INDEX_TTS_DIR 可覆盖
 *   - python：环境变量 INDEX_TTS_VENV_PYTHON 优先 → 项目 .venv\Scripts\python.exe
 *     → 回退 'python'
 *   - 模型：项目根 checkpoints/（modelscope/HuggingFace 下载 IndexTeam/IndexTTS-2.5——
 *     config.yaml + gpt.pth ~3.26G，HF_HUB_OFFLINE=1 离线推理）
 *   - 参考音色：参数 refAudio 优先；为空则用环境变量 INDEX_TTS_VOICE_PROFILE
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  schema,
  LANGS,
  isValidEmotionMode,
  normalizeEmotionMode,
  isValidEmotionPreset,
  clampDurationFactor,
  clampEmoAlpha,
} from './lib/schema'
import type {
  ActionResult,
  EnvConfig,
  ToolCall,
  ToolCallContext,
  ToolResultCompatible,
  ToolSchemaCompatible,
} from './types'

/** index_tts 外置工具 */
export class IndexTTS {
  /** IAgentTool：getSchema——返回 ToolSchema 兼容结构（含 toFunctionCallingFormat） */
  getSchema(): ToolSchemaCompatible {
    return {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
      toFunctionCallingFormat(): Record<string, unknown> {
        return {
          type: 'function',
          function: { name: schema.name, description: schema.description, parameters: schema.parameters },
        }
      },
    }
  }

  /** IAgentTool：check——可用性（整洁检查；模型/环境问题由 execute 运行时报错） */
  check(): boolean {
    return true
  }

  /** IAgentTool：execute——返回 ToolResult 兼容结构 { async, result } */
  async execute(ctx: ToolCallContext): Promise<ToolResultCompatible> {
    const r = await IndexTTS.run({ arguments: ctx?.toolCall?.arguments ?? {} })
    if (r.ok === false) {
      return { async: false, result: JSON.stringify({ error: r.error ?? '工具执行失败' }) }
    }
    return { async: false, result: JSON.stringify(r.output ?? {}) }
  }

  // ═══════════════════════════════ 私有执行逻辑 ═══════════════════════════════

  /**
   * 执行：校验参数 → spawn python 调 scripts/gen_index.py → 返回统一结果。
   * 参数校验在前段完成（不 spawn）；模型/环境问题在 spawn 段返回 ok:false。
   */
  private static async run(toolCall: ToolCall): Promise<ActionResult> {
    const t =
      toolCall && toolCall.arguments && typeof toolCall.arguments === 'object'
        ? toolCall.arguments
        : (toolCall || {})
    const args: Record<string, unknown> = t as Record<string, unknown>

    // ── 参数校验（前段——不 spawn） ──
    const text = typeof args.text === 'string' ? args.text.trim() : ''
    if (!text) {
      return { ok: false, error: 'index_tts 需要 text（要合成的文本，非空）' }
    }

    const lang = typeof args.lang === 'string' && args.lang ? (args.lang.toUpperCase() as string) : 'ZH'
    if (!(LANGS as readonly string[]).includes(lang)) {
      return {
        ok: false,
        error: `lang 必须是 IndexTTS-2.5 五语之一（ZH/EN/JA/ES/AR），收到: ${String(args.lang)}`,
      }
    }

    let durationFactor = 1.0
    if (args.durationFactor !== undefined && args.durationFactor !== null) {
      const n = Number(args.durationFactor)
      if (!Number.isFinite(n)) {
        return { ok: false, error: `durationFactor 必须是数字（0.5-2.0），收到: ${String(args.durationFactor)}` }
      }
      durationFactor = clampDurationFactor(n)
    }

    const emotionMode = typeof args.emotionMode === 'string' && args.emotionMode
      ? args.emotionMode.toLowerCase()
      : 'none'
    if (!isValidEmotionMode(emotionMode)) {
      return {
        ok: false,
        error: `emotionMode 必须是 none/audio/preset/vector 之一，收到: ${String(args.emotionMode)}`,
      }
    }
    const emoMode = normalizeEmotionMode(emotionMode)

    const emoAudioPrompt =
      typeof args.emoAudioPrompt === 'string' && args.emoAudioPrompt ? args.emoAudioPrompt : ''
    if (emoMode === 'audio' && !emoAudioPrompt) {
      return { ok: false, error: 'emotionMode=audio 时必需 emoAudioPrompt（情感参考音频路径）' }
    }

    const emotionPreset =
      typeof args.emotionPreset === 'string' && args.emotionPreset ? args.emotionPreset.toLowerCase() : ''
    if (emoMode === 'vector' && !isValidEmotionPreset(emotionPreset)) {
      return {
        ok: false,
        error: `emotionMode=preset/vector 时 emotionPreset 必须是 8 情感之一（happy/angry/sad/afraid/disgusted/melancholic/surprised/calm），收到: ${String(args.emotionPreset)}`,
      }
    }

    let emoAlpha = 1.0
    if (args.emoAlpha !== undefined && args.emoAlpha !== null) {
      const n = Number(args.emoAlpha)
      if (!Number.isFinite(n)) {
        return { ok: false, error: `emoAlpha 必须是数字（0-2），收到: ${String(args.emoAlpha)}` }
      }
      emoAlpha = clampEmoAlpha(n)
    }

    const textNormalization = args.textNormalization !== false
    let intervalSilence = 200
    if (args.intervalSilence !== undefined && args.intervalSilence !== null) {
      const n = Number(args.intervalSilence)
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: `intervalSilence 必须是非负数字（毫秒），收到: ${String(args.intervalSilence)}` }
      }
      intervalSilence = Math.floor(n)
    }
    const useRandom = Boolean(args.useRandom)
    const useBf16 = args.useBf16 !== false

    const outputPath =
      typeof args.outputPath === 'string' && args.outputPath.trim()
        ? args.outputPath.trim()
        : IndexTTS.autoOutputPath()

    const refAudio =
      typeof args.refAudio === 'string' && args.refAudio.trim() ? args.refAudio.trim() : ''

    // ── 环境解析 + 参考音色（工具配置 INDEX_TTS_VOICE_PROFILE 回退） ──
    const env = IndexTTS.detectEnv()
    const voiceProfile = refAudio || env.voiceProfile
    if (!voiceProfile) {
      return {
        ok: false,
        error: '缺少参考音色：请传 refAudio 参数，或配置工具环境变量 INDEX_TTS_VOICE_PROFILE（参考音频 wav/mp3 路径）',
      }
    }
    if (!existsSync(voiceProfile)) {
      return { ok: false, error: `参考音色文件不存在: ${voiceProfile}` }
    }
    if (!env.modelReady) {
      return {
        ok: false,
        error: `IndexTTS 模型未就绪：需要 ${env.projectDir}\\checkpoints 下的 config.yaml + gpt.pth——请按 install.md 安装（modelscope 下载 IndexTeam/IndexTTS-2.5 到 checkpoints/）`,
      }
    }
    if (!existsSync(env.script)) {
      return { ok: false, error: `合成脚本缺失: ${env.script}` }
    }

    // ── 组装 payload（对齐 scripts/gen_index.py 的 stdin JSON 契约） ──
    const payload = JSON.stringify({
      text,
      refAudio: voiceProfile,
      lang,
      durationFactor,
      emotionMode: emoMode,
      emoAudioPrompt: emoMode === 'audio' ? emoAudioPrompt : undefined,
      emotionPreset: emoMode === 'vector' ? emotionPreset : 'none',
      emoAlpha,
      textNormalization,
      intervalSilence,
      useRandom,
      useBf16,
      outPath: outputPath,
    })

    // ── spawn python（cwd=项目根——import indextts 需要项目根在 PYTHONPATH） ──
    const result = await new Promise<{ ok: boolean; outPath?: string; error?: string }>((resolve, reject) => {
      const child = spawn(env.python, [env.script], {
        cwd: env.projectDir,
        env: {
          ...process.env,
          PYTHONPATH: env.projectDir,
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
        },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d: Buffer) => { stdout += d })
      child.stderr.on('data', (d: Buffer) => { stderr += d })
      child.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(stderr.slice(-500) || `exit ${code}`))
        }
        try {
          // infer 内部 print 会污染 stdout——JSON 结果在最后——提取含 {"ok" 的行（容错解析）
          const lines = stdout.trim().split('\n')
          const jsonLine =
            lines.find((l) => l.trim().startsWith('{"ok"')) ?? lines[lines.length - 1]
          resolve(JSON.parse(jsonLine.trim()))
        } catch {
          reject(new Error(`脚本输出解析失败: ${stdout.slice(-300)}`))
        }
      })
      child.on('error', reject)
      child.stdin.end(payload)
    })

    if (!result.ok) {
      return { ok: false, error: result.error || 'IndexTTS 合成失败' }
    }
    const wavPath = result.outPath || outputPath
    return {
      ok: true,
      output: { filePath: wavPath, wavPath },
    }
  }

  /** 运行时配置解析（环境变量优先：INDEX_TTS_DIR / INDEX_TTS_VENV_PYTHON / INDEX_TTS_VOICE_PROFILE） */
  private static detectEnv(): EnvConfig {
    const projectDir = process.env.INDEX_TTS_DIR || 'C:\\tools\\index-tts'
    const pythonCandidates = [
      process.env.INDEX_TTS_VENV_PYTHON,
      join(projectDir, '.venv', 'Scripts', 'python.exe'),
      join(projectDir, '.venv', 'python.exe'),
      'python',
    ].filter((p): p is string => Boolean(p))
    const python =
      pythonCandidates.find((p) => p !== 'python' && existsSync(p)) || 'python'
    return {
      projectDir,
      python,
      script: join(__dirname, '..', 'scripts', 'gen_index.py'),
      voiceProfile: process.env.INDEX_TTS_VOICE_PROFILE || '',
      modelReady:
        existsSync(join(projectDir, 'checkpoints', 'config.yaml')) &&
        existsSync(join(projectDir, 'checkpoints', 'gpt.pth')),
    }
  }

  /** 自动生成输出路径（系统临时目录） */
  private static autoOutputPath(): string {
    return join(
      tmpdir(),
      `indextts-${Date.now()}-${Math.floor(Math.random() * 10000)}.wav`
    )
  }
}
