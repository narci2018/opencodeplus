# TRAE 宝 → opencode 完整移植方案

> 基于 2026-11-08 对 Trae CN IDE (v3.4.15+) 四大组件的深度逆向分析

## 1. 移植目标

将 TRAE 宝（开发者个人助理）作为完整智能体集成到 opencode，提供：

- **浮动宠物 UI**：始终置顶的桌面宠物/球体，任务状态可视化
- **双助理模式**：全局助理（跨项目）+ 项目助理（单项目）
- **多任务并行**：任务拆解、并行执行、进度汇总
- **IM 桥接**：飞书/微信远程派任务、查进度
- **跨会话记忆**：Chronicle 记忆系统（需跨平台适配）

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                      opencode (Bun runtime)                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                TRAE-宝 Agent 插件                       │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐             │ │
│  │  │ 浮动宠物  │  │ 双助理    │  │ 多任务    │             │ │
│  │  │  UI      │  │ 系统     │  │ 管理器   │             │ │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘             │ │
│  │       │             │             │                     │ │
│  │  ┌────▼─────────────▼─────────────▼────┐              │ │
│  │  │        Agent Runtime 核心            │              │ │
│  │  │  (任务调度 / 上下文管理 / 记忆)       │              │ │
│  │  └────────────┬────────────────────────┘              │ │
│  │               │                                        │ │
│  │  ┌────────────▼──────────┐  ┌────────────────────┐    │ │
│  │  │  IM Bridge             │  │  Chronicle 记忆     │    │ │
│  │  │  (飞书/微信子进程)      │  │  (跨会话,跨平台)     │    │ │
│  │  └───────────────────────┘  └────────────────────┘    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                 Tool Layer (MCP + Exec)                  │ │
│  │  • 标准工具 (read/write/edit/search)                     │ │
│  │  • Exec (JS V8 沙箱)                                     │ │
│  │  • Browser Use (Playwright MCP)                          │ │
│  │  • Computer Use (UI Automation)                          │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 3. 组件级移植方案

### 3.1 浮动宠物 UI（`floatingChat`）

**原始代码位置**：
- `out/vs/platform/iCubeFloatingChat/electron-main/media/`
- `out/vs/code/electron-browser/floatingChat/`

**移植策略**：保留全部原始代码，用 opencode 的窗口管理替换 Electron 主进程服务。

| 组件 | 移植方式 |
|------|---------|
| `floatingButton.html` | 直接复制，适配 opencode TUI 窗口 |
| `floatingButton-preload.js` | 直接复制，修改 IPC 通道名为 opencode 命名空间 |
| `floatingTaskStatus.html` | 直接复制，修改任务状态渲染逻辑 |
| `floatingQuickActions.html` | 直接复制 |
| `floatingFeedback.html` | 直接复制 |
| `floatingToastTransition.js` | 直接复制 |
| `traebao/renderer.js` | 直接复制（Three.js 自包含，embedded GLB） |
| `floating-chat-entry.mjs` | 从 `@byted-icube/solo-lite` 提取，替换 React 依赖 |

**配置项**：
```typescript
{
  enabled: true,           // 主开关
  buttonIcon: "traebao",   // traebao | ball
  shortcut: "Alt+Shift+Space",
  panelType: "assistant",  // assistant | task
  size: 1.0                // 0.6 - 1.5
}
```

**IPC 通道映射**（fire-and-forget，无 request/response）：
```typescript
// opencode 版本使用 Bun 的 EventEmitter + TUI 窗口管理
type FloatingChatIPC = {
  toggle: () => void
  quickCreate: (mode: 'text' | 'voice') => void
  taskStatusToggle: () => void
  taskCardOpen: (sessionId: string) => void
  assistantOpen: (target: AssistantTarget) => void
  dragMove: (x: number, y: number) => void
  contextMenu: (x: number, y: number) => void
  // ... 全部 27 个通道
}
```

### 3.2 IM Bridge（`icube-im-bridge`）

**原始代码位置**：
- `extensions/cloudide.icube-im-bridge/dist/extension.js`
- `extensions/cloudide.icube-im-bridge/dist/bridges/feishu-bridge-process.cjs`
- `extensions/cloudide.icube-im-bridge/dist/bridges/wx-bridge-process.cjs`

**移植策略**：子进程模型可以直接复用（Bun 支持 `child_process.fork`），只需替换宿主 API。

| 组件 | 移植方式 |
|------|---------|
| `extension.js` | 重写为 opencode 插件，替换 `vscode` API 为 opencode API |
| `feishu-bridge-process.cjs` | **直接复制**（自包含 bundle，无需额外依赖） |
| `wx-bridge-process.cjs` | **直接复制**（自包含 bundle） |
| `channel_config.json` | 存储路径改为 opencode 配置目录 |

**关键替换点**：
- `vscode.commands.executeCommand` → opencode `plugin.executeCommand`
- `vscode.workspace` → opencode `workspace`
- `vscode.window` → opencode `window`
- `icube.imBridge.getChannelConfigPath` → opencode 自己的配置路径
- `im.bridge.handleIncomingMessage` → opencode 消息路由

### 3.3 Chronicle 记忆（`byted-solo.builtin-mcp/chronicle`）

**原始代码位置**：
- `extensions/byted-solo.builtin-mcp/dist/chronicle/`

**关键发现**：Chronicle 是 **macOS-only**（依赖原生 `.app` 进行屏幕捕获和 OCR），在 Windows 上默认关闭。移植到 opencode 需要跨平台适配。

**Windows 替代方案**：
- 用 `@nut-tree-fork/nut-js` 或 `robotjs` 进行屏幕捕获
- 用 `tesseract.js` 进行 OCR（替代 macOS 原生 OCR）
- 或使用 `screenshot-desktop` + `tesseract.js` 的组合

| 组件 | 移植方式 |
|------|---------|
| `server.js` (MCP 服务器) | 直接复制，修改依赖 |
| `repository.js` | 直接复制 |
| `registration.js` | 重写为 opencode MCP 注册 |
| `types.js` | 直接复制 |
| 原生 `.app` (macOS) | **跳过**，用跨平台替代 |

**MCP 工具**：
```typescript
{
  chronicle_status: { /* 检查可用性、记录状态、协议版本 */ },
  chronicle_recent: { /* 获取最近的观察（最多12个） */ },
  chronicle_search: { /* 搜索记忆索引 */ },
  chronicle_get_memory: { /* 通过不透明 ID 解析记忆 */ }
}
```

### 3.4 Solo-Lite 工作台（`solo-lite`）

**原始代码位置**：
- `out/vs/workbench/workbench.desktop.main.solo-lite.js`
- `node_modules/@byted-icube/solo-lite/dist/`

**移植策略**：提取核心逻辑（双助理 + 多任务并行），不复制整个 React 工作台。

**双助理系统**：
```typescript
type AssistantTarget = {
  scopeEpoch: number
  kind: 'default' | 'project'  // default = 全局, project = 项目
  projectId?: string
  sessionId?: string
}

type AssistantProfile = {
  assistantType: 'default' | 'project'
  targetId?: string
  revision: number
  customName?: string
  name?: string
  // ...
}
```

**多任务并行**（核心原语）：
```typescript
class ConcurrencyLimiter {
  constructor(maxDegreeOfParallelism: number)
  queue(factory: () => Promise<void>): void
  whenIdle(): Promise<void>
}

class TaskQueue {
  constructor(delayMs: number)
  trigger(fn: () => void): void
}
```

**任务状态机**：
```
working → completed | failed | cancelled | input_required
input_required → completed | failed | cancelled
```

**IM 流式任务循环**（多会话并行完成检测）：
```typescript
async function sendPromptStreamingResponse(...) {
  // 两个并行轮询器（200ms 间隔）
  // 1. 流式文本提取
  // 2. 空闲检测
  // 完成条件：所有 IM 会话空闲 && 无待处理交互
  // 超时：5分钟
}
```

## 4. opencode 插件架构

### 4.1 目录结构

```
opencode-trae-bao/
├── package.json              # 插件清单
├── plugin.ts                 # 主入口
├── src/
│   ├── floating-chat/        # 浮动宠物 UI
│   │   ├── media/            # 原始 HTML/JS/CSS（直接复制）
│   │   ├── floating-chat.ts  # 窗口管理
│   │   └── ipc.ts            # IPC 通道定义
│   ├── im-bridge/            # IM 桥接
│   │   ├── bridges/          # 子进程 bundle（直接复制）
│   │   ├── im-bridge.ts      # 桥接管理器
│   │   └── channel-config.ts # 配置存储
│   ├── chronicle/            # 跨会话记忆
│   │   ├── server.ts         # MCP 服务器
│   │   ├── repository.ts     # 存储仓库
│   │   └── windows-ocr.ts    # Windows 替代实现
│   ├── agent/                # Agent 核心
│   │   ├── assistant.ts      # 双助理管理
│   │   ├── tasks.ts          # 多任务并行
│   │   ├── concurrency.ts    # ConcurrencyLimiter
│   │   └── review.ts         # 代码审查聚合
│   └── config/
│       ├── defaults.ts       # 默认配置
│       └── schema.ts         # 配置 schema
├── skills/                   # 技能文件
│   ├── TRAE-browseruse/      # 浏览器自动化
│   ├── TRAE-computer-use/    # 桌面操作
│   └── TRAE-code-mode/       # 代码模式
└── assets/
    └── traebao/              # 3D 宠物模型（直接复制）
```

### 4.2 插件清单

```json
{
  "name": "opencode-trae-bao",
  "version": "0.1.0",
  "description": "TRAE 宝完整移植 - 浮动宠物 + 双助理 + 多任务并行 + IM 桥接 + 跨会话记忆",
  "main": "./plugin.ts",
  "engines": {
    "opencode": ">=1.0.0"
  },
  "contributes": {
    "agents": [
      {
        "id": "trae-bao",
        "name": "TRAE 宝",
        "description": "开发者个人助理：跨项目记忆、多任务并行、IM 桥接",
        "mode": "primary"
      }
    ],
    "skills": [
      "skills/TRAE-browseruse",
      "skills/TRAE-computer-use",
      "skills/TRAE-code-mode"
    ],
    "mcp": [
      {
        "id": "chronicle",
        "name": "Chronicle 记忆"
      }
    ]
  }
}
```

### 4.3 主入口

```typescript
// plugin.ts
import { definePlugin } from '@opencode/plugin'

export default definePlugin(async (ctx) => {
  // 1. 初始化浮动宠物 UI
  const floatingChat = await createFloatingChat(ctx)
  
  // 2. 初始化 IM 桥接
  const imBridge = await createIMBridge(ctx)
  
  // 3. 初始化 Chronicle 记忆
  const chronicle = await createChronicle(ctx)
  
  // 4. 初始化双助理系统
  const assistants = await createAssistants(ctx)
  
  // 5. 注册 agent
  ctx.registerAgent('trae-bao', {
    name: 'TRAE 宝',
    system: TRAE_BAO_SYSTEM_PROMPT,
    tools: [...defaultTools, ...mcpTools],
    permissions: { /* ... */ }
  })
  
  return {
    dispose() {
      floatingChat.dispose()
      imBridge.dispose()
      chronicle.dispose()
      assistants.dispose()
    }
  }
})
```

## 5. 实施阶段

### Phase 1: 基础骨架（1-2天）
- [ ] 创建插件目录结构
- [ ] 复制浮动宠物 UI 原始代码
- [ ] 复制 IM Bridge 子进程 bundle
- [ ] 复制 Chronicle MCP 服务器代码
- [ ] 配置 plugin.ts 入口

### Phase 2: 核心适配（2-3天）
- [ ] 浮动宠物 UI 适配 opencode 窗口管理
- [ ] IM Bridge 适配 opencode 命令系统
- [ ] Chronicle 适配跨平台（Windows OCR 替代）
- [ ] 双助理系统实现

### Phase 3: 集成测试（2-3天）
- [ ] 浮动宠物显示/拖拽/点击测试
- [ ] IM 桥接登录/消息测试
- [ ] 多任务并行执行测试
- [ ] 跨会话记忆测试

### Phase 4: 优化完善（1-2天）
- [ ] 性能优化（渲染帧率、内存）
- [ ] 错误处理与重连机制
- [ ] 文档编写

## 6. 已知限制

| 限制 | 影响 | 解决方案 |
|------|------|---------|
| Chronicle 仅 macOS | Windows 无法使用原生屏幕捕获 | 使用 tesseract.js + screenshot-desktop |
| 3D 宠物模型 710KB GLB | 插件体积增大 | 按需加载（Lazy Load） |
| 飞书 OAuth 需要字节账号 | 无法在 opencode 独立使用 | 提供自定义 API 配置 |
| 微信 bridge 需要 openclaw | 依赖第三方 SDK | 保持自包含 bundle |
| IM Bridge 子进程 2.5MB | 启动延迟 | 按需启动（Lazy Spawn） |
| 浮动宠物需要 GUI | 无法在 headless 环境使用 | 自动禁用，仅 TUI 模式 |
| 动态配置来自云端 | 本地无法获取 | 提供本地配置文件 |

## 7. 依赖清单

| 依赖 | 用途 | 来源 |
|------|------|------|
| `three` | 3D 宠物渲染 | 内嵌于 renderer.js（无需安装） |
| `@larksuiteoapi/node-sdk` | 飞书 SDK | 内嵌于 feishu-bridge-process.cjs |
| `openclaw-weixin` | 微信 SDK | 内嵌于 wx-bridge-process.cjs |
| `tesseract.js` | Windows OCR | 需要安装 |
| `screenshot-desktop` | 屏幕捕获 | 需要安装 |
| `@opencode/plugin` | opencode 插件 API | opencode 内置 |
