/**
 * 配置模块
 * 
 * 从 Trae CN 提取的配置项定义：
 * - trae.floatingChat.* → 浮动宠物配置
 * - AI.soloLite.chronicle.enable → 记忆配置
 * - ai_assistant.request.* → Agent 请求配置
 */

export interface TraeBaoConfig {
  floatingChat: {
    enabled: boolean
    buttonIcon: 'traebao' | 'ball'
    shortcut: string
    panelType: 'assistant' | 'task'
    size: number
  }
  chronicle: {
    enabled: boolean
    consentAccepted: boolean
    product: 'opencode'
    accountId: string
  }
  imBridge: {
    feishu: {
      enabled: boolean
      domain: 'feishu' | 'lark'
      groupMentionPolicy: 'everyone' | 'owner_only'
    }
    wx: {
      enabled: boolean
    }
  }
  agent: {
    taskServiceStrategy: string
    webFetchStrategy: 'auto' | 'block' | 'allow'
    enableHarness: boolean
    maxParallelTasks: number
  }
}

export const DEFAULT_CONFIG: TraeBaoConfig = {
  floatingChat: {
    enabled: true,
    buttonIcon: 'traebao',
    shortcut: 'Alt+Shift+Space',
    panelType: 'assistant',
    size: 1.0,
  },
  chronicle: {
    enabled: false,
    consentAccepted: false,
    product: 'opencode',
    accountId: '',
  },
  imBridge: {
    feishu: {
      enabled: false,
      domain: 'feishu',
      groupMentionPolicy: 'everyone',
    },
    wx: {
      enabled: false,
    },
  },
  agent: {
    taskServiceStrategy: '',
    webFetchStrategy: 'auto',
    enableHarness: false,
    maxParallelTasks: 4,
  },
}

export function mergeConfig(base: TraeBaoConfig, override: Partial<TraeBaoConfig>): TraeBaoConfig {
  return {
    ...base,
    ...override,
    floatingChat: { ...base.floatingChat, ...override.floatingChat },
    chronicle: { ...base.chronicle, ...override.chronicle },
    imBridge: {
      ...base.imBridge,
      feishu: { ...base.imBridge.feishu, ...override.imBridge?.feishu },
      wx: { ...base.imBridge.wx, ...override.imBridge?.wx },
    },
    agent: { ...base.agent, ...override.agent },
  }
}
