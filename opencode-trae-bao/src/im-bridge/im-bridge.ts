/**
 * IM Bridge 管理器（飞书/微信）
 * 
 * 从 Trae CN cloudide.icube-im-bridge 移植：
 * - 子进程桥接（child_process.fork）
 * - 飞书：OIDC 设备码登录 + WebSocket 长连接
 * - 微信：QR 码登录 + 长轮询
 * - Watchdog 自动重连（指数退避）
 * 
 * 子进程 bundle 直接从 Trae CN 复制（自包含，无需额外依赖）
 */

import { fork, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface IMBridgeConfig {
  feishu?: {
    appId?: string
    appSecret?: string
    domain?: 'feishu' | 'lark'
    userOpenId?: string
    botName?: string
    botAvatarUrl?: string
    enabled?: boolean
    groupMentionPolicy?: 'everyone' | 'owner_only'
  }
  wx?: {
    enabled?: boolean
  }
}

export interface IMBridgeMessage {
  channel: 'feishu' | 'wx'
  text: string
  images?: Array<{ filePath: string; mimeType: string }>
  files?: Array<{ filePath: string; fileName: string }>
  messageId?: string
  replyToMessageId?: string
  chatId?: string
  chatType?: string
  conversationId?: string
  appId?: string
  sentAt?: number
}

export interface IMBridgeHandle {
  /** 登录飞书 */
  loginFeishu(): Promise<void>
  /** 登录微信 */
  loginWechat(): Promise<void>
  /** 发送回复 */
  reply(channel: 'feishu' | 'wx', payload: any): void
  /** 主动推送 */
  push(channel: 'feishu' | 'wx', payload: any): void
  /** 解绑 */
  unbind(channel: 'feishu' | 'wx'): Promise<void>
  /** 暂停 */
  pause(channel: 'feishu' | 'wx'): void
  /** 恢复 */
  resume(channel: 'feishu' | 'wx'): void
  /** 检查绑定状态 */
  checkBound(channel: 'feishu' | 'wx'): Promise<{ bound: boolean; appId?: string }>
  /** 监听消息 */
  onMessage(callback: (message: IMBridgeMessage) => void): void
  /** 监听事件 */
  onEvent(callback: (event: any) => void): void
  /** 监听错误 */
  onError(callback: (error: { channel: 'feishu' | 'wx'; message: string }) => void): void
  /** 销毁 */
  dispose(): void
}

// 消息协议（从 extension.js 提取）
type FeishuCommand =
  | 'login' | 'connect' | 'reconnect' | 'health_probe' | 'stop'
  | 'reply' | 'reply_card' | 'push' | 'unbind'
  | 'stream_start' | 'stream_update' | 'stream_end' | 'stream_abort'
  | 'upload_file' | 'pause' | 'resume' | 'interaction'
  | 'update_reaction' | 'update_config' | 'session_card_start' | 'session_card_update' | 'session_card_delete'

type WxCommand =
  | 'login' | 'reconnect' | 'start' | 'stop' | 'reply' | 'push'
  | 'pause' | 'resume' | 'interaction' | 'clear_interaction' | 'update_config'

interface ChildMessage {
  type: string
  payload?: any
  connectContext?: any
}

/**
 * 创建 IM Bridge 管理器
 * 
 * 使用 child_process.fork 启动子进程，子进程 bundle 直接从 Trae CN 复制。
 */
export async function createIMBridge(
  ctx: any,
  config: IMBridgeConfig = {},
  dataDir?: string,
): Promise<IMBridgeHandle> {
  const emitter = new EventEmitter()
  // 'error' 是 EventEmitter 保留事件名：无监听器时 emit('error') 会抛未处理错误。
  // 提供默认监听器避免子进程任何 error 消息直接崩溃插件进程。
  emitter.on('error', (channel: 'feishu' | 'wx', payload: any) => {
    console.error(`[IMBridge:${channel}] Error event:`, payload?.message ?? payload)
  })
  const bridges = new Map<string, ChildProcess>()
  const configDir = dataDir ?? join(process.cwd(), '.trae-bao', 'im-bridge')
  const channelConfigPath = join(configDir, 'channel_config.json')

  // 确保配置目录存在
  mkdirSync(configDir, { recursive: true })

  // 加载/保存配置
  function loadConfig(): IMBridgeConfig {
    if (existsSync(channelConfigPath)) {
      try {
        return JSON.parse(readFileSync(channelConfigPath, 'utf8'))
      } catch {
        return config
      }
    }
    return config
  }

  function saveConfig(cfg: IMBridgeConfig) {
    writeFileSync(channelConfigPath, JSON.stringify(cfg, null, 2), 'utf8')
  }

  // 启动子进程
  function spawnBridge(channel: 'feishu' | 'wx'): ChildProcess | null {
    const moduleDir = fileURLToPath(new URL('.', import.meta.url))
    const scriptPath = join(
      moduleDir,
      'bridges',
      channel === 'feishu' ? 'feishu-bridge-process.cjs' : 'wx-bridge-process.cjs',
    )

    if (!existsSync(scriptPath)) {
      console.warn(`[IMBridge] Bridge script not found: ${scriptPath}`)
      return null
    }

    const env: Record<string, string> = {
      ...process.env,
      // 桥接子进程配置
      IM_BRIDGE_PROJECT_NAME: 'opencode',
      IM_BRIDGE_BOT_DISPLAY_NAME: 'TRAE 宝',
      IM_BRIDGE_WORKSPACE_NAME: 'opencode',
      IM_BRIDGE_GROUP_MENTION_POLICY: 'everyone',
    }

    if (channel === 'feishu') {
      const cfg = loadConfig().feishu
      if (cfg) {
        env.IM_BRIDGE_CONFIG = JSON.stringify({
          feishu: cfg,
          accountsBaseUrl: 'https://accounts.feishu.cn',
          openApiBaseUrl: 'https://open.feishu.cn',
        })
      }
      env.FEISHU_BRIDGE_STATE_DIR = join(configDir, 'feishu')
    } else {
      env.OPENCLAW_STATE_DIR = join(configDir, 'wx')
    }

    const child = fork(scriptPath, [], {
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execArgv: [],
    })

    child.stdout?.on('data', (data) => {
      console.log(`[IMBridge:${channel}:stdout]`, data.toString().trimEnd())
    })
    child.stderr?.on('data', (data) => {
      console.error(`[IMBridge:${channel}:stderr]`, data.toString().trimEnd())
    })

    child.on('message', (msg: ChildMessage) => {
      emitter.emit('bridge-event', channel, msg)

      switch (msg.type) {
        case 'qrcode':
          emitter.emit('qrcode', channel, msg.payload)
          break
        case 'credentials':
          if (channel === 'feishu') {
            const cfg = loadConfig()
            cfg.feishu = {
              ...cfg.feishu,
              appId: msg.payload.appId,
              appSecret: msg.payload.appSecret,
              userOpenId: msg.payload.userOpenId,
              domain: msg.payload.domain,
            }
            saveConfig(cfg)
          }
          emitter.emit('connected', channel, msg.payload)
          break
        case 'connected':
          emitter.emit('connected', channel, msg.payload)
          break
        case 'message':
          emitter.emit('message', {
            channel,
            text: msg.payload.text,
            images: msg.payload.imagePaths?.map((p: string) => ({ filePath: p, mimeType: 'image/png' })),
            files: msg.payload.files,
            messageId: msg.payload.messageId,
            replyToMessageId: msg.payload.replyToMessageId,
            chatId: msg.payload.chatId,
            chatType: msg.payload.chatType,
            conversationId: msg.payload.conversationId,
            appId: msg.payload.appId,
            sentAt: msg.payload.sentAt,
          })
          break
        case 'connection_lost':
        case 'connection_restored':
        case 'reconnecting':
        case 'reconnect_failed':
          emitter.emit('status', channel, msg.type, msg.payload)
          break
        case 'error':
          emitter.emit('error', channel, msg.payload)
          break
        case 'disconnected':
          emitter.emit('disconnected', channel, msg.payload)
          break
      }
    })

    child.on('exit', (code, signal) => {
      console.log(`[IMBridge:${channel}] Process exited (code=${code}, signal=${signal})`)
      bridges.delete(channel)
      emitter.emit('disconnected', channel, { reason: `Process exited (code=${code})` })
    })

    child.on('error', (err) => {
      console.error(`[IMBridge:${channel}] Process error: ${err.message}`)
      emitter.emit('error', channel, { message: err.message })
    })

    return child
  }

  // 发送命令到子进程
  function sendCommand(channel: 'feishu' | 'wx', command: string, payload?: any) {
    const child = bridges.get(channel)
    if (child) {
      child.send({ command, payload })
    }
  }

  return {
    async loginFeishu() {
      let child = bridges.get('feishu')
      if (!child) {
        child = spawnBridge('feishu') ?? undefined
        if (child) bridges.set('feishu', child)
      }
      sendCommand('feishu', 'login', {})
    },

    async loginWechat() {
      let child = bridges.get('wx')
      if (!child) {
        child = spawnBridge('wx') ?? undefined
        if (child) bridges.set('wx', child)
      }
      sendCommand('wx', 'login', {})
    },

    reply(channel, payload) {
      sendCommand(channel, 'reply', payload)
    },

    push(channel, payload) {
      sendCommand(channel, 'push', payload)
    },

    async unbind(channel) {
      sendCommand(channel, 'stop', {})
      const child = bridges.get(channel)
      if (child) {
        setTimeout(() => child.kill('SIGKILL'), 5000)
      }
    },

    pause(channel) {
      sendCommand(channel, 'pause', {})
    },

    resume(channel) {
      sendCommand(channel, 'resume', {})
    },

    async checkBound(channel) {
      if (channel === 'feishu') {
        const cfg = loadConfig().feishu
        return { bound: !!(cfg?.appId && cfg?.appSecret), appId: cfg?.appId }
      }
      return { bound: false }
    },

    onMessage(callback) {
      emitter.on('message', callback)
    },

    onEvent(callback) {
      emitter.on('bridge-event', callback)
    },

    onError(callback) {
      emitter.on('error', (channel, payload) => {
        callback({ channel, message: payload?.message ?? String(payload) })
      })
    },

    dispose() {
      for (const [channel, child] of bridges) {
        try {
          child.send({ command: 'stop' })
          setTimeout(() => child.kill('SIGKILL'), 5000)
        } catch {
          child.kill('SIGKILL')
        }
      }
      bridges.clear()
      emitter.removeAllListeners()
    },
  }
}
