/**
 * types.ts — index_tts 外置工具类型定义（全部归位本文件）
 */

/** ToolSchema 兼容结构（JS 弱类型——与主程序 ToolSchema 结构一致即可，含 toFunctionCallingFormat） */
export interface ToolSchemaCompatible {
  name: string
  description: string
  parameters: Record<string, unknown> | null
  toFunctionCallingFormat(): Record<string, unknown>
}

/** ToolResult 兼容结构（与主程序 ToolResult 含 { async, result }） */
export interface ToolResultCompatible {
  async: boolean
  result: string
}

/** execute 入参（IAgentTool 的 ToolContext 兼容——取 toolCall.arguments） */
export interface ToolCallContext {
  toolCall?: { arguments?: Record<string, unknown> }
}

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
