/**
 * types.ts — index_tts 外置工具类型定义（全部归位本文件）
 */

/** 工具契约（ToolSchema / ToolResult / ToolContext / IAgentTool）统一取自 tinkerdesk-types——不在本文件重抄 */

/** execute 入参（兼容 { arguments } 包装或直接 args 对象） */
export type ToolCall =
  | { arguments?: Record<string, unknown> }
  | Record<string, unknown>

/** execute 统一返回 */
export interface ActionResult {
  ok: boolean
  output?: { filePath: string; wavPath: string }
  error?: string
}

/** 运行时环境配置（IndexTTS 项目根/venv python/脚本/参考音色/模型就绪） */
export interface EnvConfig {
  projectDir: string
  python: string
  script: string
  voiceProfile: string
  modelReady: boolean
}
