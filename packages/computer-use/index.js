/**
 * index.js — TinkerDesk 外置完整工具：computer_use
 *
 * 迁移自 tinkerdesk/src/main/tools/computer-use/computer-use-tool.ts（功能 1:1）。
 * 自包含 Node 模块——不依赖 TinkerDesk 内部 BaseTool / ToolContext / ToolResult，仅用标准库。
 *
 * 导出：{ schema, execute }
 *   - schema: 工具 schema（含 actions 数组）
 *   - execute(toolCall): 接收 { arguments: {...} } 或直接 args 对象，按 action 分发
 *     调用 cua-driver client，保留安全门检，返回 { ok: boolean, output?: string, error?: string }。
 *
 * Desktop background control (cua-driver — macOS/Windows/Linux):
 *   截图（capture：som/vision/ax）、鼠标（click 系列/drag/scroll）、键盘（type/key/set_value）、
 *   窗口（list_apps/list_windows/focus_app）、wait、typed browser（cua_browser_* 8 个）。
 *
 * 安全模型（1:1）：
 *   - capture/wait/list 系列/cua_browser_state 免费
 *   - 其余 action 经门检层审批（外置工具层只做硬封锁门检——由宿主门检链负责 ASK 审批）
 *   - 硬封锁：危险按键组合（清废纸篓/锁屏/登出等）+ 危险文本模式（curl|bash/sudo rm -rf/fork bomb）
 */

'use strict'

const {
  CuaDriverClient,
  CuaDriverUnavailableError,
} = require('./lib/cua-driver-client')
const {
  COMPUTER_USE_ACTIONS,
  COMPUTER_USE_BLOCKED_KEY_COMBOS,
  canonKeyCombo,
  blockedTypePattern,
} = require('./lib/schema')

/** typed browser action → cua-driver 工具名 */
const ACTION_TO_BROWSER_TOOL = {
  cua_browser_navigate: 'browser_navigate',
  cua_browser_click: 'browser_click',
  cua_browser_type: 'browser_type',
  cua_browser_pointer: 'browser_pointer',
  cua_browser_dialog: 'browser_dialog',
  cua_browser_set_input_files: 'browser_set_input_files',
  cua_browser_download: 'browser_download',
}

/** cua-driver typed browser 工具名 → 白名单字段（_dispatch） */
const BROWSER_ALLOWED_FIELDS = {
  browser_navigate: ['url'],
  browser_click: ['ref', 'input_route', 'x', 'y'],
  browser_type: ['ref', 'text'],
  browser_pointer: ['ref', 'destination_ref', 'input_route', 'x', 'y', 'to_x', 'to_y', 'delta_x', 'delta_y'],
  browser_dialog: ['dialog_id', 'prompt_text', 'delivery_mode'],
  browser_set_input_files: ['ref', 'files'],
  browser_download: ['ref', 'destination_root'],
}

/** 工具 schema（OpenAI function calling 结构——含 actions 数组） */
const schema = {
  name: 'computer_use',
  description:
    '截屏 + 鼠标/键盘/拖拽 + 应用窗口 + 浏览器自动化控制计算机桌面（基于 cua-driver）。单工具 + action 判别（24 类动作）。',
  actions: COMPUTER_USE_ACTIONS,
  safeActions: ['capture', 'wait', 'list_apps', 'list_windows', 'cua_browser_state'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: COMPUTER_USE_ACTIONS,
        description: '要执行的操作类型',
      },
    },
    required: ['action'],
  },
}

/**
 * execute — 按 action 分发调用 cua-driver client，返回统一结果对象。
 * @param {{arguments?: Record<string, unknown>} | Record<string, unknown>} toolCall
 * @returns {Promise<{ok: boolean, output?: string, error?: string}>}
 */
async function execute(toolCall) {
  const t = toolCall && toolCall.arguments && typeof toolCall.arguments === 'object'
    ? toolCall.arguments
    : (toolCall || {})
  const args = t

  const action = String(args.action || '').trim().toLowerCase()
  if (!action || !COMPUTER_USE_ACTIONS.includes(action)) {
    return { ok: false, error: `missing or unknown action: ${action || '(empty)'}` }
  }

  // ── 硬封锁门检（工具内双保险——门检层也做） ──
  if (action === 'type' || action === 'cua_browser_type') {
    const pat = blockedTypePattern(String(args.text || ''))
    if (pat) {
      return {
        ok: false,
        error: `blocked pattern in type text: ${pat}`,
        hint: 'Dangerous shell patterns cannot be typed via computer_use.',
      }
    }
  }
  if (action === 'key') {
    const combo = canonKeyCombo(String(args.keys || ''))
    for (const blocked of COMPUTER_USE_BLOCKED_KEY_COMBOS) {
      if (blocked.size <= combo.size && [...blocked].every((k) => combo.has(k))) {
        return {
          ok: false,
          error: `blocked key combo: ${[...blocked].sort()}`,
          hint: 'Destructive system shortcuts are hard-blocked.',
        }
      }
    }
  }
  if (args.bring_to_front && args.delivery_mode !== 'foreground') {
    return { ok: false, error: "bring_to_front requires delivery_mode='foreground'" }
  }

  // ── 后端（cua-driver） ──
  let client
  try {
    client = new CuaDriverClient()
    await client.start()
    await client.startSession()
  } catch (e) {
    return {
      ok: false,
      error: `computer_use backend unavailable: ${(e && e.message) || String(e)}`,
      hint: '安装 cua-driver：PowerShell 执行 irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex',
    }
  }

  try {
    const result = await dispatch(client, action, args)
    return { ok: true, output: result }
  } catch (e) {
    if (e instanceof CuaDriverUnavailableError) {
      return { ok: false, error: e.message }
    }
    return { ok: false, error: `${action} failed: ${(e && e.message) || String(e)}` }
  } finally {
    // 会话级隔离由宿主管理；这里每个 execute 独立启停子进程，防止资源泄漏
    try { client.stop() } catch { /* ignore */ }
  }
}

/** action 分发（_dispatch——参数组装 1:1） */
async function dispatch(client, action, args) {
  const captureAfter = Boolean(args.capture_after)

  switch (action) {
    case 'capture': {
      const mode = String(args.mode || 'som')
      if (!['som', 'vision', 'ax'].includes(mode)) {
        return JSON.stringify({ error: `bad mode ${mode}; use som|vision|ax` })
      }
      const maxElements = coerceMaxElements(args.max_elements)
      // 解析目标 pid/window_id：显式传参优先；否则 list_windows 匹配 app 或取第一个窗口
      let pid = args.pid
      let windowId = args.window_id
      if (pid === undefined || windowId === undefined) {
        const windows = await listWindowsParsed(client)
        // 跳过 cua-driver 自身的 overlay/授权进程窗口（拒绝操作自己）
        const usable = windows.filter((w) => !/cua|agentcursor/i.test(w.name))
        const app = String(args.app || '')
        const target = app
          ? usable.find((w) => w.name.toLowerCase().includes(app.toLowerCase())) || usable[0]
          : usable[0]
        if (target) {
          pid = pid === undefined ? target.pid : pid
          windowId = windowId === undefined ? target.windowId : windowId
        }
      }
      if (pid === undefined || windowId === undefined) {
        return JSON.stringify({ error: '未找到目标窗口——请先 list_windows 或传 app/pid/window_id' })
      }
      // capture → get_window_state（新驱动把截图折叠进 get_window_state；老驱动用 screenshot）
      const tool = client.hasTool('get_window_state') ? 'get_window_state' : 'screenshot'
      const res = await client.callTool(tool, { pid, window_id: windowId, mode })
      return captureResponse(res, maxElements)
    }

    case 'wait': {
      // wait = 纯等待（不调 cua-driver——setTimeout 实现）
      const seconds = Math.max(0, Math.min(Number(args.seconds ?? 1), 30))
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
      return JSON.stringify({ ok: true, message: `waited ${seconds}s` })
    }

    case 'list_apps': {
      const res = await client.callTool('list_apps', {})
      const apps = parseJsonArray(res)
      return JSON.stringify({ apps, count: apps.length })
    }

    case 'list_windows': {
      const res = await client.callTool('list_windows', {})
      const windows = parseJsonArray(res)
      return JSON.stringify({ windows, count: windows.length })
    }

    case 'focus_app': {
      const app = args.app
      if (!app) return JSON.stringify({ error: 'focus_app requires `app`' })
      const res = await client.callTool('launch_app', { app })
      return maybeFollowCapture(client, res, captureAfter)
    }

    case 'cua_browser_state': {
      const stateArgs = {}
      for (const k of ['pid', 'window_id', 'tab_id', 'snapshot_format', 'query', 'scope_ref', 'continuation']) {
        if (args[k] !== undefined) stateArgs[k] = args[k]
      }
      const res = await client.callTool('get_browser_state', stateArgs)
      return client.extractText(res)
    }

    case 'cua_browser_prepare': {
      const res = await client.callTool('browser_prepare', {
        pid: args.pid,
        window_id: args.window_id,
        profile_mode: args.profile_mode || 'isolated_new',
        profile_name: args.profile_name,
        allow_launch: Boolean(args.allow_launch),
      })
      return client.extractText(res)
    }

    default: {
      const browserTool = ACTION_TO_BROWSER_TOOL[action]
      if (browserTool) {
        const callArgs = {}
        for (const field of BROWSER_ALLOWED_FIELDS[browserTool]) {
          if (args[field] !== undefined) callArgs[field] = args[field]
        }
        if (
          (browserTool === 'browser_click' || browserTool === 'browser_pointer') &&
          Array.isArray(args.coordinate) && args.coordinate.length === 2
        ) {
          callArgs.x = args.coordinate[0]
          callArgs.y = args.coordinate[1]
        }
        if (args.browser_pointer_action !== undefined) callArgs.action = args.browser_pointer_action
        if (args.browser_dialog_action !== undefined) callArgs.action = args.browser_dialog_action
        if (args.browser_type_mode !== undefined) callArgs.mode = args.browser_type_mode
        const res = await client.callTool(browserTool, { ...callArgs, tab_id: args.tab_id })
        return client.extractText(res)
      }
      return dispatchInput(client, action, args, captureAfter)
    }
  }
}

/** 输入类 action（click 系列/drag/scroll/type/key/set_value）——_dispatch 尾部 */
async function dispatchInput(client, action, args, captureAfter) {
  const deliveryMode = args.delivery_mode
  const bringToFront = Boolean(args.bring_to_front)
  const coord = Array.isArray(args.coordinate) && args.coordinate.length === 2 ? args.coordinate : null

  if (action === 'click' || action === 'double_click' || action === 'right_click' || action === 'middle_click') {
    let button = String(args.button || '')
    let clickCount = 1
    if (action === 'double_click') clickCount = 2
    else if (action === 'right_click') button = 'right'
    else if (action === 'middle_click') button = 'middle'
    else button = button || 'left'
    const tool = clickCount === 2 ? 'double_click' : 'click'
    const res = await client.callTool(tool, {
      button,
      element_index: args.element,
      x: coord ? coord[0] : undefined,
      y: coord ? coord[1] : undefined,
      modifier: args.modifiers,
      delivery_mode: deliveryMode,
      bring_to_front: bringToFront,
    })
    return maybeFollowCapture(client, res, captureAfter)
  }

  if (action === 'drag') {
    const hasElements = args.from_element !== undefined && args.to_element !== undefined
    const hasCoords = Array.isArray(args.from_coordinate) && Array.isArray(args.to_coordinate)
    if (!hasElements && !hasCoords) {
      return JSON.stringify({ error: 'drag requires from_coordinate/to_coordinate or from_element/to_element' })
    }
    const res = await client.callTool('drag', {
      from_element: args.from_element,
      to_element: args.to_element,
      from_xy: args.from_coordinate,
      to_xy: args.to_coordinate,
      button: args.button || 'left',
      modifier: args.modifiers,
      delivery_mode: deliveryMode,
      bring_to_front: bringToFront,
    })
    return maybeFollowCapture(client, res, captureAfter)
  }

  if (action === 'scroll') {
    const res = await client.callTool('scroll', {
      direction: args.direction || 'down',
      amount: Number(args.amount ?? 3),
      element_index: args.element,
      x: coord ? coord[0] : undefined,
      y: coord ? coord[1] : undefined,
      modifier: args.modifiers,
      delivery_mode: deliveryMode,
      bring_to_front: bringToFront,
    })
    return maybeFollowCapture(client, res, captureAfter)
  }

  if (action === 'type') {
    const res = await client.callTool('type_text', {
      text: String(args.text || ''),
      delivery_mode: deliveryMode,
      bring_to_front: bringToFront,
    })
    return maybeFollowCapture(client, res, captureAfter)
  }

  if (action === 'key') {
    const res = await client.callTool('hotkey', {
      keys: String(args.keys || ''),
      delivery_mode: deliveryMode,
      bring_to_front: bringToFront,
    })
    return maybeFollowCapture(client, res, captureAfter)
  }

  if (action === 'set_value') {
    if (args.value === undefined) return JSON.stringify({ error: 'set_value requires `value`' })
    const res = await client.callTool('set_value', {
      value: String(args.value),
      element_index: args.element,
    })
    return maybeFollowCapture(client, res, captureAfter)
  }

  return JSON.stringify({ error: `unknown action ${action}` })
}

/** 解析 list_windows 文本输出 → 窗口列表（name/pid/windowId）——宽松逐行解析（格式有变体） */
async function listWindowsParsed(client) {
  const res = await client.callTool('list_windows', {})
  const text = client.extractText(res)
  const out = []
  for (const line of text.split('\n')) {
    if (!line.includes('window_id')) continue
    const nameM = /"([^"]+)"/.exec(line)
    const pidM = /pid\s+(\d+)/.exec(line)
    const winM = /window_id:\s*(\d+)/.exec(line)
    if (!pidM || !winM) continue
    out.push({
      name: nameM ? nameM[1] : '',
      pid: Number(pidM[1]),
      windowId: Number(winM[1]),
    })
  }
  return out
}

// ── 结果格式化（_capture_response / _text_response） ──

/**
 * capture 返回：AX 树文本为主（含 [N] 编号——模型可直接点击）。
 * 图像 base64 不返回（会撑爆上下文）。未来接入视觉模型时按模型能力返回 image_data_url。
 */
function captureResponse(res, _maxElements) {
  const content = res.content || []
  const text = content
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('\n')
  const summary = text.length > 6000
    ? `${text.slice(0, 6000)}\n...(AX 树截断，total ${text.length} 字符——可提高 max_elements 或传 app 缩小范围)`
    : text
  if (summary) return summary
  return JSON.stringify({ ok: true, message: 'capture 完成（无 AX 树——窗口可能无无障碍内容）' })
}

function maybeFollowCapture(client, res, captureAfter) {
  const base = clientExtractTextSafe(res)
  if (captureAfter) {
    return dispatch(client, 'capture', {})
  }
  return base
}

function coerceMaxElements(v) {
  const n = Number(v)
  if (Number.isFinite(n)) return Math.min(Math.max(Math.floor(n), 1), 1000)
  return 100
}

/** 解析 MCP 结果的 JSON 数组（list_apps/list_windows——cua-driver 返回文本 JSON） */
function parseJsonArray(res) {
  const text = clientExtractTextSafe(res)
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.apps)) return parsed.apps
    if (parsed && Array.isArray(parsed.windows)) return parsed.windows
  } catch {
    // 非 JSON 文本——返回空
  }
  return []
}

/** 工具内文本提取 */
function clientExtractTextSafe(res) {
  const parts = []
  for (const c of (res && res.content) || []) {
    if (c.type === 'text' && c.text) parts.push(c.text)
  }
  return parts.join('\n')
}

module.exports = { schema, execute }
