/**
 * lib/schema.ts — index_tts 工具 schema + 常量 + 参数校验辅助
 *
 * 工具契约（对应 scripts/gen_index.py 的 stdin JSON 全参数）：
 *   text/text, refAudio, lang, durationFactor, emotionMode, emoAudioPrompt,
 *   emotionPreset, emoAlpha, textNormalization, intervalSilence,
 *   useRandom, useBf16, outPath
 */

/** IndexTTS-2.5 支持的五种语言 */
export const LANGS = ['ZH', 'EN', 'JA', 'ES', 'AR'] as const
export type Lang = (typeof LANGS)[number]

/** 情感控制方式：none（同音色）/ audio（情感参考音频）/ vector（情感向量预设，别名 preset） */
export const EMOTION_MODES = ['none', 'audio', 'preset', 'vector'] as const
export type EmotionMode = (typeof EMOTION_MODES)[number]

/** 8 种情感向量预设（顺序对齐 gen_index.py 的 EMO_PRESETS） */
export const EMOTION_PRESETS = [
  'happy',
  'angry',
  'sad',
  'afraid',
  'disgusted',
  'melancholic',
  'surprised',
  'calm',
] as const
export type EmotionPreset = (typeof EMOTION_PRESETS)[number]

/** 语速 duration_factor 合法区间（0.5-2.0——>1 更慢 <1 更快，speed 的倒数） */
export const DURATION_FACTOR_MIN = 0.5
export const DURATION_FACTOR_MAX = 2.0

/** emoAlpha 合法区间 */
export const EMO_ALPHA_MIN = 0
export const EMO_ALPHA_MAX = 2

/** 工具 schema（OpenAI function calling 结构——全参数） */
export const schema = {
  name: 'index_tts',
  description:
    '调用本机 IndexTTS2（IndexTTS-2.5）生成克隆语音——给定参考音色音频合成语音，支持语速（durationFactor）、情感控制（音频参考/8 向量预设）、五语（ZH/EN/JA/ES/AR）、文本归一化等全参数。',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '要合成的文本内容（必填）',
      },
      lang: {
        type: 'string',
        enum: [...LANGS],
        default: 'ZH',
        description: '合成语言（IndexTTS-2.5 五语：ZH 中文 / EN 英文 / JA 日文 / ES 西班牙文 / AR 阿拉伯文）',
      },
      durationFactor: {
        type: 'number',
        minimum: DURATION_FACTOR_MIN,
        maximum: DURATION_FACTOR_MAX,
        default: 1.0,
        description: '语速/时长系数 0.5-2.0——>1 更慢 <1 更快（speed 的倒数），如 2.0 为 0.5 倍速朗读',
      },
      emotionMode: {
        type: 'string',
        enum: [...EMOTION_MODES],
        default: 'none',
        description: '情感控制方式：none 同音色 / audio 用情感参考音频 / preset（同 vector）用情感向量预设',
      },
      emoAudioPrompt: {
        type: 'string',
        description: '情感参考音频路径（wav/mp3——emotionMode=audio 时生效）',
      },
      emotionPreset: {
        type: 'string',
        enum: [...EMOTION_PRESETS],
        description: '情感预设（emotionMode=preset/vector 时生效——8 情感：happy/angry/sad/afraid/disgusted/melancholic/surprised/calm）',
      },
      emoAlpha: {
        type: 'number',
        minimum: EMO_ALPHA_MIN,
        maximum: EMO_ALPHA_MAX,
        default: 1.0,
        description: '情感强度 0-2（默认 1.0）',
      },
      textNormalization: {
        type: 'boolean',
        default: true,
        description: '文本归一化（数字/日期转口语——中文拼音/英文 CMU 音素/日文假名）',
      },
      intervalSilence: {
        type: 'number',
        default: 200,
        description: '长文本分段间隔静音毫秒数（默认 200）',
      },
      useRandom: {
        type: 'boolean',
        default: false,
        description: '随机采样（增强表现力——会降低克隆保真度）',
      },
      useBf16: {
        type: 'boolean',
        default: true,
        description: 'BF16 半精度推理（省显存——IndexTTS-2.5 支持）',
      },
      outputPath: {
        type: 'string',
        description: '输出 wav 文件路径（可空——空则自动生成到系统临时目录并返回该路径）',
      },
      refAudio: {
        type: 'string',
        description: '参考音色音频路径（wav/mp3——5-10 秒清晰人声；可空——空则用工具配置 INDEX_TTS_VOICE_PROFILE）',
      },
    },
    required: ['text'],
  },
}

// schema 顶层平铺 properties（兼容宿主读取 schema.properties.* 的两种方式）
Object.defineProperty(schema, 'properties', {
  enumerable: true,
  get: () => schema.parameters.properties,
})

export type IndexTtsArgs = typeof schema.parameters.properties

/** 归一化情感模式：preset → vector（gen_index.py 用 vector 分支） */
export function normalizeEmotionMode(mode: string): string {
  const m = String(mode || 'none').toLowerCase()
  return m === 'preset' ? 'vector' : m
}

/** 校验 emotionMode 是否合法 */
export function isValidEmotionMode(mode: string): boolean {
  return (EMOTION_MODES as readonly string[]).includes(mode)
}

/** 校验情感预设是否在 8 预设内 */
export function isValidEmotionPreset(preset: string): boolean {
  return (EMOTION_PRESETS as readonly string[]).includes(preset)
}

/** clamp durationFactor 到 [0.5, 2.0] */
export function clampDurationFactor(v: number): number {
  return Math.min(DURATION_FACTOR_MAX, Math.max(DURATION_FACTOR_MIN, v))
}

/** clamp emoAlpha 到 [0, 2] */
export function clampEmoAlpha(v: number): number {
  return Math.min(EMO_ALPHA_MAX, Math.max(EMO_ALPHA_MIN, v))
}