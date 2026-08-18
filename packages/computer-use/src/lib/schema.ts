/**
 * lib/schema.ts — computer_use 工具 Schema（迁移自 tinkerdesk/src/main/tools/computer-use/schema.ts）
 *
 * Single tool + action discriminator (24 actions) — keeps the schema compact and per-turn token cost low.
 * 模型无关：capture(mode='som') → click(element=N) 最可靠；像素坐标保留给训练过的模型。
 *
 * 本文件为纯 TypeScript 自包含实现——仅使用 Node 标准库，不依赖 TinkerDesk 内部类。
 */

/** computer_use 全部 action（联合类型） */
export type ComputerUseAction =
  | 'capture' | 'click' | 'double_click' | 'right_click' | 'middle_click'
  | 'drag' | 'scroll' | 'type' | 'key' | 'set_value' | 'wait'
  | 'list_apps' | 'list_windows' | 'focus_app'
  | 'cua_browser_state' | 'cua_browser_prepare' | 'cua_browser_navigate'
  | 'cua_browser_click' | 'cua_browser_type' | 'cua_browser_pointer'
  | 'cua_browser_dialog' | 'cua_browser_set_input_files' | 'cua_browser_download'

/** computer_use 全部 action（24 个） */
export const COMPUTER_USE_ACTIONS: readonly ComputerUseAction[] = [
  'capture', 'click', 'double_click', 'right_click', 'middle_click',
  'drag', 'scroll', 'type', 'key', 'set_value', 'wait',
  'list_apps', 'list_windows', 'focus_app',
  'cua_browser_state', 'cua_browser_prepare', 'cua_browser_navigate',
  'cua_browser_click', 'cua_browser_type', 'cua_browser_pointer',
  'cua_browser_dialog', 'cua_browser_set_input_files', 'cua_browser_download',
]

/** 只读、无副作用（免费） */
export const COMPUTER_USE_SAFE_ACTIONS: ReadonlySet<string> = new Set([
  'capture', 'wait', 'list_apps', 'list_windows', 'cua_browser_state',
])

/** 改变用户可见状态（需审批） */
export const COMPUTER_USE_DESTRUCTIVE_ACTIONS: ReadonlySet<string> = new Set([
  'click', 'double_click', 'right_click', 'middle_click',
  'drag', 'scroll', 'type', 'key', 'set_value', 'focus_app',
  'cua_browser_prepare', 'cua_browser_navigate', 'cua_browser_click',
  'cua_browser_type', 'cua_browser_pointer', 'cua_browser_dialog',
  'cua_browser_set_input_files', 'cua_browser_download',
])

/** 硬封锁按键组合（无论审批级别——破坏性系统快捷键） */
export const COMPUTER_USE_BLOCKED_KEY_COMBOS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['cmd', 'shift', 'backspace']), // 清空废纸篓
  new Set(['cmd', 'option', 'backspace']), // 强制删除
  new Set(['cmd', 'ctrl', 'q']), // 锁屏
  new Set(['cmd', 'shift', 'q']), // 登出
  new Set(['cmd', 'option', 'shift', 'q']), // 强制登出
  new Set(['win', 'l']), // Windows 锁屏
  new Set(['ctrl', 'option', 'delete']), // Windows 安全
  new Set(['ctrl', 'option', 'del']),
  new Set(['option', 'f4']), // Windows 关闭
]

/** 按键别名（统一到 cua-driver 规范名） */
export const COMPUTER_USE_KEY_ALIASES: Record<string, string> = {
  command: 'cmd', control: 'ctrl', alt: 'option', '⌘': 'cmd', '⌥': 'option',
  windows: 'win', super: 'win', meta: 'win',
}

/** 危险文本模式（type 动作）——curl|bash / sudo rm -rf / fork bomb 等 */
export const COMPUTER_USE_BLOCKED_TYPE_PATTERNS: RegExp[] = [
  /curl\s+[^|]*\|\s*bash/i,
  /curl\s+[^|]*\|\s*sh/i,
  /wget\s+[^|]*\|\s*bash/i,
  /\bsudo\s+rm\s+-[rf]/i,
  /\brm\s+-rf\s+\/\s*$/i,
  /:\s*\(\)\s*\{\s*:|\:\s*&\s*\}/i, // fork bomb
]

/** 按键组合规范化（+ / - 分隔均可——防连字符绕过） */
export function canonKeyCombo(keys: string | null | undefined): ReadonlySet<string> {
  const parts = String(keys || '')
    .split(/[\s+-]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .map((p) => COMPUTER_USE_KEY_ALIASES[p] ?? p)
  return new Set(parts)
}

/** type 文本危险检测——返回命中的模式描述或 null */
export function blockedTypePattern(text: string | null | undefined): string | null {
  for (const pat of COMPUTER_USE_BLOCKED_TYPE_PATTERNS) {
    if (pat.test(String(text || ''))) return pat.source
  }
  return null
}