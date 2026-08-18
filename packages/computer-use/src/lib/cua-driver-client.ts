/**
 * lib/cua-driver-client.ts — cua-driver MCP 客户端（自包含 STDIO 实现）
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

import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

/** cua-driver 不可用 */
export class CuaDriverUnavailableError extends Error {
  constructor(hint: string) {
    super(`cua-driver 不可用: ${hint}`)
    this.name = 'CuaDriverUnavailableError'
  }
}

/** 解析 cua-driver 可执行文件：PATH → 用户本地安装位置（Windows 官方安装目录） */
export function resolveCuaDriverCmd(): string | null {
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

function isWin(): boolean {
  return process.platform === 'win32'
}

/** MCP 文本内容块 */
export interface MCPTextContent {
  type: string
  text?: string
}

/** MCP 工具调用结果（tools/call） */
export interface MCPToolResult {
  content: MCPTextContent[]
  isError?: boolean
}

/** MCP 工具清单项 */
export interface MCPToolInfo {
  name: string
  [key: string]: any
}

/** JSON-RPC 响应（宽松类型——不同 server 字段略有差异） */
interface RpcResponse {
  result?: any
  error?: { message?: string } | null
  content?: MCPTextContent[]
  isError?: boolean
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (err: Error) => void
}

/**
 * 自包含 MCP stdio 传输（替代 tinkerdesk StdioTransport）
 * 通过 stdin/stdout 以 JSON-RPC 2.0 逐行通信，匹配 id 关联请求/响应。
 */
export class StdioTransport {
  child: ChildProcessWithoutNullStreams | null = null
  pending: Map<number, PendingRequest> = new Map()
  buffer = ''
  idCounter = 0
  private _connected = false

  get connected(): boolean {
    return this._connected
  }

  async connect(cmd: string, args: string[]): Promise<void> {
    if (!cmd) throw new Error('MCP stdio transport requires a command')

    return new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
      this.child = child

      let started = false

      child.stdout.on('data', (data) => {
        this.buffer += data.toString()
        this.processBuffer()
        if (!started) {
          started = true
          this._connected = true
          resolve()
        }
      })

      child.stderr.on('data', () => {
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

  async request(method: string, params?: unknown): Promise<any> {
    if (!this.child || !this._connected) throw new Error('MCP not connected')
    const id = ++this.idCounter
    const req = { jsonrpc: '2.0', id, method, params }

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child!.stdin!.write(JSON.stringify(req) + '\n')
    }).then((res) => {
      const r = res as RpcResponse
      if (r.error) throw new Error(r.error.message || 'MCP error')
      return r
    })
  }

  async listTools(): Promise<MCPToolInfo[]> {
    const res = await this.request('tools/list')
    return (res.result && res.result.tools) || []
  }

  async callTool(name: string, args: unknown): Promise<MCPToolResult> {
    const res = await this.request('tools/call', { name, arguments: args })
    const result = (res.result && res.result) || {}
    return { content: result.content || [], isError: result.isError || false }
  }

  close(): void {
    if (this.child) {
      try { this.child.stdin.end() } catch { /* ignore */ }
      try { this.child.kill('SIGTERM') } catch { /* ignore */ }
      setTimeout(() => { try { this.child?.kill('SIGKILL') } catch { /* ignore */ } }, 3000)
      this.child = null
    }
    this._connected = false
  }

  processBuffer(): void {
    const lines = this.buffer.split('\n')
    while (lines.length > 1) {
      const line = lines.shift()!
      this.buffer = lines.join('\n')
      try {
        const msg = JSON.parse(line) as any
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
export class CuaDriverClient {
  transport: StdioTransport | null = null
  sessionId: string | null = null
  toolNames: Set<string> = new Set()

  /** 检查 cua-driver 是否可用（PATH + 官方安装位置） */
  static async isAvailable(): Promise<boolean> {
    return resolveCuaDriverCmd() !== null
  }

  /** 启动 cua-driver mcp 子进程 + 握手（initialize + tools/list） */
  async start(): Promise<void> {
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
  async startSession(): Promise<string> {
    const sid = `tinker-${randomUUID().slice(0, 8)}`
    await this.callRaw('start_session', { session: sid })
    this.sessionId = sid
    return sid
  }

  /** 结束会话 */
  async endSession(): Promise<void> {
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
  async callTool(name: string, args: Record<string, any>): Promise<MCPToolResult> {
    const merged: Record<string, any> = { ...(args || {}) }
    if (this.sessionId && name !== 'start_session' && name !== 'end_session') {
      merged.session = this.sessionId
    }
    return this.callRaw(name, merged)
  }

  /** 原始 tools/call（isError 时抛错） */
  async callRaw(name: string, args: Record<string, any>): Promise<MCPToolResult> {
    if (!this.transport) throw new CuaDriverUnavailableError('cua-driver 未启动')
    const res = await this.transport.callTool(name, args || {})
    if (res.isError) {
      const text = this.extractText(res)
      throw new Error(`cua-driver ${name} 失败: ${text || '未知错误'}`)
    }
    return res
  }

  /** 从 MCP 结果提取文本（content 数组拼接） */
  extractText(res: MCPToolResult): string {
    const parts: string[] = []
    for (const c of res.content || []) {
      if (c.type === 'text' && c.text) parts.push(c.text)
    }
    return parts.join('\n')
  }

  /** 工具能力判断 */
  hasTool(name: string): boolean {
    return this.toolNames.has(name)
  }

  /** 关闭子进程 */
  stop(): void {
    this.sessionId = null
    if (this.transport) {
      try { this.transport.close() } catch { /* 已关闭 */ }
      this.transport = null
    }
  }
}