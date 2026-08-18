/**
 * lib/cua-driver-client.js — cua-driver MCP 客户端（自包含 STDIO 实现）
 *
 * 迁移自 tinkerdesk/src/main/tools/computer-use/cua-driver-client.ts
 * 原实现基于 tinkerdesk StdioTransport——此处将 MCP stdio JSON-RPC 2.0 传输内联为自包含实现，
 * 不依赖 TinkerDesk 内部类，仅使用 Node 标准库（child_process / fs / crypto）。
 *
 * cua-driver is an external standalone program (trycua/cua — 编译好的 Rust 二进制，
 * Windows/macOS/Linux 全平台）:
 *   cua-driver mcp   ← stdio 传输的 MCP 服务
 * 安装（Windows PowerShell）:
 *   irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex
 */

'use strict'

const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { existsSync } = require('node:fs')

/** cua-driver 不可用 */
class CuaDriverUnavailableError extends Error {
  constructor(hint) {
    super(`cua-driver 不可用: ${hint}`)
    this.name = 'CuaDriverUnavailableError'
  }
}

/** 解析 cua-driver 可执行文件：PATH → 用户本地安装位置（Windows 官方安装目录） */
function resolveCuaDriverCmd() {
  // 1. PATH
  const pathEnv = process.env.PATH || ''
  const sep = pathEnv.includes(';') ? ';' : ':'
  const pathCmd = pathEnv
    .split(sep)
    .map((p) => `${p}${p.endsWith('\\') || p.endsWith('/') ? '' : '/\\'}cua-driver${isWin() ? '.exe' : ''}`)
    .find((p) => existsSync(p))
  if (pathCmd) return pathCmd
  // 2. 常见安装位置
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const localAppData = process.env.LOCALAPPDATA || `${home.replace(/\\/g, '/')}/AppData/Local`
  const base = localAppData.replace(/\/+$/, '')
  const candidates = [
    `${home}/.local/bin/cua-driver${isWin() ? '.exe' : ''}`,
    `${base}/Programs/Cua/cua-driver/bin/cua-driver${isWin() ? '.exe' : ''}`,
    `${base}/Programs/cua-driver/bin/cua-driver${isWin() ? '.exe' : ''}`,
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

function isWin() {
  return process.platform === 'win32'
}

/**
 * 自包含 MCP stdio 传输（替代 tinkerdesk StdioTransport）
 * 通过 stdin/stdout 以 JSON-RPC 2.0 逐行通信，匹配 id 关联请求/响应。
 */
class StdioTransport {
  constructor() {
    this.child = null
    this.pending = new Map()
    this.buffer = ''
    this.idCounter = 0
    this._connected = false
  }

  get connected() {
    return this._connected
  }

  async connect(cmd, args) {
    if (!cmd) throw new Error('MCP stdio transport requires a command')

    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
      this.child = child

      let started = false

      child.stdout?.on('data', (data) => {
        this.buffer += data.toString()
        this.processBuffer()
        if (!started) {
          started = true
          this._connected = true
          resolve()
        }
      })

      child.stderr?.on('data', () => {
        // MCP servers often log to stderr; ignore by default
      })

      child.on('error', (err) => {
        this._connected = false
        if (!started) reject(err)
      })

      child.on('close', () => {
        this._connected = false
        for (const [, pending] of this.pending) pending.reject(new Error('MCP process closed'))
        this.pending.clear()
      })

      // Timeout: if no data after 10s, assume connection failed
      setTimeout(() => {
        if (!started) {
          child.kill()
          reject(new Error('MCP connection timeout'))
        }
      }, 10000)
    }).then(async () => {
      // MCP initialize 握手（部分 server 要求先 initialize 再 tools/list）
      await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'tinkerdesk-tool-computer-use', version: '1.0.0' },
      }).catch(() => { /* 老版本 server 可能不接受，忽略 */ })
    })
  }

  async request(method, params) {
    if (!this.child || !this._connected) throw new Error('MCP not connected')
    const id = ++this.idCounter
    const req = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin?.write(JSON.stringify(req) + '\n')
    }).then((res) => {
      if (res.error) throw new Error(res.error.message || 'MCP error')
      return res
    })
  }

  async listTools() {
    const res = await this.request('tools/list')
    return (res.result && res.result.tools) || []
  }

  async callTool(name, args) {
    const res = await this.request('tools/call', { name, arguments: args })
    const result = (res.result && res.result) || {}
    return { content: result.content || [], isError: result.isError || false }
  }

  close() {
    if (this.child) {
      try { this.child.stdin?.end() } catch { /* ignore */ }
      try { this.child.kill('SIGTERM') } catch { /* ignore */ }
      setTimeout(() => { try { this.child?.kill('SIGKILL') } catch { /* ignore */ } }, 3000)
      this.child = null
    }
    this._connected = false
  }

  processBuffer() {
    const lines = this.buffer.split('\n')
    while (lines.length > 1) {
      const line = lines.shift()
      this.buffer = lines.join('\n')
      try {
        const msg = JSON.parse(line)
        if (msg.id != null) {
          const pending = this.pending.get(msg.id)
          if (pending) {
            this.pending.delete(msg.id)
            pending.resolve(msg)
          }
        }
      } catch {
        // Non-JSON output (e.g. startup logs), ignore
      }
    }
  }
}

/** cua-driver MCP 客户端（Stdio 薄封装——每实例一个子进程 + 会话） */
class CuaDriverClient {
  constructor() {
    this.transport = null
    this.sessionId = null
    this.toolNames = new Set()
  }

  /** 检查 cua-driver 是否可用（PATH + 官方安装位置） */
  static async isAvailable() {
    return resolveCuaDriverCmd() !== null
  }

  /** 启动 cua-driver mcp 子进程 + 握手（initialize + tools/list） */
  async start() {
    if (this.transport && this.transport.connected) return
    const cmd = resolveCuaDriverCmd()
    if (!cmd) {
      throw new CuaDriverUnavailableError(
        '未找到 cua-driver——请安装（PowerShell: irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex）'
      )
    }
    const transport = new StdioTransport()
    await transport.connect(cmd, ['mcp'])
    this.transport = transport
    const tools = await transport.listTools()
    for (const t of tools) this.toolNames.add(t.name)
  }

  /** 开启 cua-driver 会话（start_session——后续 call_tool 自动带 session） */
  async startSession() {
    const sid = `tinker-${randomUUID().slice(0, 8)}`
    await this.callRaw('start_session', { session: sid })
    this.sessionId = sid
    return sid
  }

  /** 结束会话 */
  async endSession() {
    if (this.sessionId) {
      try {
        await this.callRaw('end_session', { session: this.sessionId })
      } catch {
        // 会话可能已结束——忽略
      }
      this.sessionId = null
    }
  }

  /** 调用 cua-driver 工具（自动合并 session 参数）——返回 { content, isError } */
  async callTool(name, args) {
    const merged = { ...(args || {}) }
    if (this.sessionId && name !== 'start_session' && name !== 'end_session') {
      merged.session = this.sessionId
    }
    return this.callRaw(name, merged)
  }

  /** 原始 tools/call（isError 时抛错） */
  async callRaw(name, args) {
    if (!this.transport) throw new CuaDriverUnavailableError('cua-driver 未启动')
    const res = await this.transport.callTool(name, args || {})
    if (res.isError) {
      const text = this.extractText(res)
      throw new Error(`cua-driver ${name} 失败: ${text || '未知错误'}`)
    }
    return res
  }

  /** 从 MCP 结果提取文本（content 数组拼接） */
  extractText(res) {
    const parts = []
    for (const c of res.content || []) {
      if (c.type === 'text' && c.text) parts.push(c.text)
    }
    return parts.join('\n')
  }

  /** 工具能力判断 */
  hasTool(name) {
    return this.toolNames.has(name)
  }

  /** 关闭子进程 */
  stop() {
    this.sessionId = null
    if (this.transport) {
      try { this.transport.close() } catch { /* 已关闭 */ }
      this.transport = null
    }
  }
}

module.exports = {
  CuaDriverClient,
  CuaDriverUnavailableError,
  resolveCuaDriverCmd,
  StdioTransport,
}
