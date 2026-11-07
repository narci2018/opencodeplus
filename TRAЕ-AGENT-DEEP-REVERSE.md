# Trae CN Agent 深度逆向报告

## 执行摘要

本报告详细记录了 Trae CN IDE (v3.4.15) 内置 AI Agent 的逆向分析结果。通过配置提取、skill 文件分析和 MCP 工具定义研究，完整还原了 agent 的架构、工具集和工作流。

---

## 1. 架构概览

### 1.1 系统组成

```
Trae CN IDE (Electron + VS Code fork v3.4.15)
├── 主进程 (Main Process)
│   ├── Agent 编排引擎
│   ├── Skill 管理器
│   └── MCP Server 注册表
├── Agent 运行时 (Agent Runtime)
│   ├── Solo Agent (独立模式)
│   ├── Code Mode (代码模式)
│   └── Design Mode (设计模式)
├── Tool Host (工具执行环境)
│   ├── Exec (JavaScript V8 沙箱)
│   ├── Browser MCP
│   ├── Computer Use MCP
│   └── 自定义 MCP Servers
└── Skill 系统
    ├── Built-in Skills (~/.trae-cn/builtin_skills/)
    ├── Downloaded Skills (CDN 缓存)
    └── Skill Catalog Manifests
```

### 1.2 Agent 类型映射

从 `mapping.json` 提取：

| Agent ID | 内部名称 | 适用场景 | 模型后端 |
|----------|---------|---------|---------|
| solo_agent | trae | 通用编程任务 | 多模型映射 |
| solo_design_lite | design | UI/UX 设计 | 多模型映射 |
| solo_agent_lite | code | 快速代码任务 | 多模型映射 |
| solo_work_lite | work | 文档/写作 | 多模型映射 |
| solo_agent_remote | trae | 远程执行 | 云端 API |
| solo_work_remote | work | 远程文档 | 云端 API |
| solo_design_remote | design | 远程设计 | 云端 API |

### 1.3 模型映射策略

不同模型对应不同的 skill 组合：

- **GPT 系列** (gpt-5.x, gpt-6): 使用 `gpt` 配置，启用 Computer Use
- **DeepSeek 系列**: 使用 `non_multimodal` 配置，禁用视觉能力
- **Doubao Seed 系列**: 使用 `seed` 或 `doutops` 配置，启用高级工具
- **自定义模型**: 默认使用 `default` 配置

---

## 2. 工具集完整清单

### 2.1 核心工具 (exec_mcp)

#### Exec - JavaScript 沙箱执行器

**Server Name**: `integrated_code_mode`

```json
{
  "name": "Exec",
  "description": "Runs raw JavaScript in an isolated V8 context.",
  "arguments": {
    "properties": {
      "code": {
        "description": "JavaScript source code to execute in the V8 sandbox",
        "type": "string"
      }
    },
    "required": ["code"],
    "type": "object"
  }
}
```

**运行时全局变量**：
- `tools` — 工具调用代理
- `ALL_TOOLS` — 只读工具列表 `{name, description, parameters}`
- `text(value)` — 输出结果（会被 JSON.stringify）
- `exit()` — 提前终止执行
- `image(rawToolResult)` — 处理截图结果

**约束**：
- ❌ 无文件系统访问
- ❌ 无网络访问 (`fetch` 不可用)
- ❌ 无 `require`/`process`/`Buffer`
- ❌ 无 `console`/`setTimeout`
- ✅ 仅 ECMAScript 标准内置对象可用

### 2.2 生产工具 (integrated_default)

#### GenerateImage - AI 图像生成

```json
{
  "name": "GenerateImage",
  "arguments": {
    "properties": {
      "prompt": {"type": "string", "description": "详细的图像描述"},
      "path": {"type": "string", "description": "保存路径（不含扩展名）"},
      "image_size": {
        "type": "string",
        "enum": ["square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"]
      }
    },
    "required": ["prompt", "path", "image_size"]
  }
}
```

#### GenerateVideo - AI 视频生成

```json
{
  "name": "GenerateVideo",
  "arguments": {
    "properties": {
      "prompt": {"type": "string", "description": "视频生成指令"},
      "file_path": {"type": "string", "description": "输出路径（自动添加 .mp4）"},
      "duration": {"enum": [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], "default": 5},
      "ratio": {"enum": ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"]},
      "resolution": {"enum": ["480p", "720p"]},
      "image_paths": {"type": "array", "maxItems": 9},
      "video_paths": {"type": "array", "maxItems": 3}
    },
    "required": ["prompt", "file_path"]
  }
}
```

**限制**：
- 每次会话只能调用一次 GenerateVideo
- 达到调用限制后必须停止并重试

#### PureShowWidget - 内联可视化渲染

```json
{
  "name": "PureShowWidget",
  "arguments": {
    "properties": {
      "title": {"type": "string", "description": "可视化标识符（snake_case）"},
      "widget_code": {"type": "string", "description": "SVG 或 HTML 代码"},
      "loading_messages": {"type": "array", "maxItems": 4, "description": "加载提示语"},
      "mode": {"enum": ["inline", "panel"], "default": "inline"}
    },
    "required": ["loading_messages", "title", "widget_code"]
  }
}
```

**约束**：
- 必须在 TRAE-dynamic-ui Skill 加载后才能调用
- 不得自行决定使用此工具

#### Schedule - 定时任务管理

```json
{
  "name": "Schedule",
  "arguments": {
    "properties": {
      "action": {
        "enum": ["create", "update", "pause", "resume", "delete", "list", "get", "trigger"]
      },
      "cron_expression": {"type": "string", "description": "5 字段 Unix Cron 格式"},
      "message": {"type": "string", "description": "任务内容"},
      "name": {"type": "string", "description": "任务名称"},
      "scheduled_task_id": {"type": "string"},
      "timezone": {"type": "string", "default": "Asia/Shanghai"}
    },
    "required": ["action"]
  }
}
```

**约束**：
- 仅支持 cron 周期任务，不支持一次性任务
- 不支持秒级精度
- 不支持复杂周期（如"每两周"）

#### RequestAuthorization - 第三方服务授权

```json
{
  "name": "RequestAuthorization",
  "arguments": {
    "properties": {
      "service": {"type": "string", "description": "授权目标服务名"},
      "scopes": {"type": "array", "description": "权限范围"}
    },
    "required": ["service", "scopes"]
  }
}
```

**支持的服务**：
- `trae-remote-official:lark::feishu` — 飞书工作流

### 2.3 浏览器工具 (browseruse_mcp)

包含 26 个工具，分为两类：

**必须在 Exec 内调用**：
- `browser_navigate`, `browser_navigate_back`
- `browser_tabs`, `browser_snapshot`, `browser_take_screenshot`
- `browser_get_attribute`, `browser_get_input_value`
- `browser_is_checked`, `browser_is_enabled`, `browser_is_visible`
- `browser_console_messages`, `browser_network_requests`
- `browser_search`, `browser_click`, `browser_type`, `browser_fill`
- `browser_fill_form`, `browser_hover`, `browser_scroll`
- `browser_press_key`, `browser_select_option`, `browser_drag`
- `browser_upload_file`, `browser_handle_dialog`
- `browser_evaluate`, `browser_wait_for`

**必须独立调用**：
- `browser_waiting_for_user_interaction` — CAPTCHA、支付确认等需要用户判断的操作

### 2.4 Computer Use 工具 (computer_use_mcp)

**Server Name**: `ide_mcp.config.ext.computer-use`

**查询工具**：
- `list_apps` — 列出已安装应用
- `get_app_state` — 获取应用 UI 状态（含截图）
- `launch_app` — 启动应用

**操作工具**：
- `click` — 点击元素
- `scroll` — 滚动
- `drag` — 拖拽
- `type_text` — 输入文本
- `press_key` — 按键
- `perform_action` — 执行可访问性动作
- `set_value` — 设置值
- `select_text` — 选择文本

**坐标系统**：
- 使用 0-1000 分数坐标，非像素
- 0,0 = 窗口左上角，500,500 = 中心，1000,1000 = 右下角

---

## 3. Skill 系统详解

### 3.1 Skill 定义格式

每个 Skill 是一个 Markdown 文件，包含 YAML frontmatter：

```yaml
---
name: TRAE-browseruse
description: "Browser automation operation guide..."
user_invocable: false
metadata:
  version: "1.0.1"
  last_modified: "2026-10-13T15:23:17+08:00"
---
```

### 3.2 Skill 分类

**系统自动加载** (`user_invocable: false`)：
- TRAE-browseruse
- TRAE-browseruse-external
- TRAE-code-mode-orchestrator

**用户可手动触发** (`user_invocable: true`)：
- TRAE-computer-use-ptc
- TRAE-product-knowledge
- TRAE-debugger
- TRAE-code-review
- TRAE-security-review
- dynamic-ui
- schedule
- skill-creator

### 3.3 内置 Skill 完整列表

| Skill | 用途 | 位置 |
|-------|------|------|
| TRAE-code-mode-orchestrator | Code Mode 编排指南 | `global/skills/` |
| TRAE-browseruse | 浏览器自动化 | `global/skills/` |
| TRAE-browseruse-external | 外部浏览器控制 | `global/skills/` |
| TRAE-computer-use-ptc | Windows 桌面操作 | `global/skills/` |
| TRAE-product-knowledge | 产品知识问答 | `global/skills/` |
| TRAE-debugger | 复杂问题调试 | `builtin_skills/` |
| TRAE-code-review | 代码审查 | `builtin_skills/` |
| TRAE-security-review | 安全审计 | `builtin_skills/` |
| TRAE-generate-mini-app | 快速生成小型应用 | `builtin_skills/` |
| dynamic-ui | 内联可视化渲染 | `global/skills/` |
| schedule | 定时任务管理 | `global/skills/` |
| skill-creator | Skill 创建工具 | `global/skills/` |

### 3.4 Skill 下载机制

**CDN 地址**：
```
https://p11-market.byteimg.com/tos-cn-i-17oceyzymr/skills/{path}/package.zip
```

**示例**：
```
https://p11-market.byteimg.com/tos-cn-i-17oceyzymr/skills/1/trae_agent::default::prod_20260910::TRAE-browseruse/0.0.12/package.zip
```

**版本控制**：
- 版本号格式：`0.0.12`
- 构建标签：`prod_20260910`
- SHA256 校验：确保文件完整性

---

## 4. 工作流与决策逻辑

### 4.1 Code Mode 决策树

```
用户请求到达
    │
    ├─ 是否有专用 Skill 需要 Exec？
    │   ├─ 是 → 遵循该 Skill 的 Exec 契约
    │   └─ 否 ↓
    │
    ├─ 核心工作是否是 LLM 文本生成？
    │   ├─ 是 → 直接执行（不使用 Code Mode）
    │   └─ 否 ↓
    │
    ├─ 是否可用 ≤2 次顺序工具调用完成？
    │   ├─ 是 → 直接工具调用
    │   └─ 否 ↓
    │
    ├─ 是否涉及 fan-out / 循环 / 条件分支？
    │   ├─ 是 → Code Mode
    │   └─ 否 ↓
    │
    ├─ 是否需要在工具间合并/去重/转换输出？
    │   ├─ 是 → Code Mode
    │   └─ 否 ↓
    │
    └─ 是否有验证步骤？
        ├─ 是 → Code Mode
        └─ 否 → 直接工具调用
```

### 4.2 Debugger Skill 激活流程

```
用户请求调试意图
    │
    ├─ Pre-Activation Intent Gate
    │   ├─ 用户明确要求调试？✓
    │   └─ 仅是症状描述？✗（不激活）
    │
    ├─ Pre-Activation Selection Gate
    │   ├─ 有专用调试 Skill？→ 使用专用
    │   └─ 无专用选项？→ 使用 TRAE-debugger
    │
    ├─ Pre-Activation Complexity Gate
    │   ├─ 需要运行时证据？✓
    │   └─ 静态分析可解决？✗（不激活）
    │
    └─ 激活 TRAE-debugger
        ├─ 生成 Session ID
        ├─ 创建 debug-<sessionId>.md
        ├─ 列出假设
        └─ 插入日志代码（不修改业务逻辑）
```

### 4.3 会话记忆系统

**存储位置**：`~/.trae-cn/memory/projects/<project-id>/`

**文件格式**：
- `session_memory_*.jsonl` — 会话记忆（JSONL 格式）
- `topics.md` — 主题总结
- `project_memory.md` — 项目级持久记忆

**记忆条目结构**：
```json
{
  "intent": "用户意图描述",
  "actions": ["执行的动作列表"],
  "outcome": "执行结果",
  "learned": ["学到的经验"],
  "message_summary_time": "时间戳",
  "message_id": "消息ID"
}
```

---

## 5. 网络协议分析

### 5.1 认证机制

**JWT Token**：存储在 `~/.trae-cn/trae-jwt-token`

**认证流程**：
1. 用户登录 Trae CN 账户
2. 获取 JWT token
3. Token 用于所有 API 请求
4. Token 过期后自动刷新

### 5.2 API 端点

从 `main.js` 和配置中提取：

**主要域名**：
- `abtestvm.bytedance.com` — A/B 测试配置
- `gator.volces.com` — 网关服务
- `libraweb-sg.tiktok.com` — 新加坡 CDN
- `libraweb-va.tiktok.com` — 越南 CDN
- `maliva-mcs.byteoversea.com` — 字节海外服务
- `mcs.zijieapi.com` — 字节国内服务

**API 模式**：
```
POST /api/v1/agent/execute
POST /api/v1/chat/completions
GET /api/v1/skills/list
POST /api/v1/skills/download
```

---

## 6. 与 opencode 的兼容性分析

### 6.1 可直接移植的功能

| 功能 | 移植难度 | 说明 |
|------|---------|------|
| System Prompt | ⭐ 简单 | 已提取并格式化 |
| Skill 定义 | ⭐⭐ 中等 | 需转换为 opencode skills 格式 |
| 工具调用协议 | ⭐⭐⭐ 复杂 | 需实现 MCP bridge |
| Exec 沙箱 | ⭐⭐⭐⭐ 困难 | opencode 无原生支持 |
| Browser MCP | ⭐⭐ 中等 | 可集成 Playwright MCP |
| Computer Use | ⭐⭐⭐⭐ 困难 | 需 Windows UI Automation |

### 6.2 关键差异

**opencode 缺失的能力**：
1. **Exec 工具**：JavaScript V8 沙箱环境
2. **Skill 热加载**：运行时动态加载 skill 文件
3. **多模式切换**：Code Mode / Design Mode / Work Mode
4. **会话记忆**：跨会话的持久化学习

**opencode 已有的能力**：
1. **标准工具集**：read, write, edit, search, shell
2. **MCP 支持**：可扩展的工具系统
3. **自定义 Agent**：通过 config 配置
4. **插件系统**：可扩展架构

---

## 7. 逆向发现总结

### 7.1 核心发现

1. **Skill-based 架构**：Trae CN agent 的核心是 skill 系统，每个 skill 是一个 Markdown 文件，定义工具使用指南和决策逻辑

2. **分层工具调用**：
   - 第一层：标准工具（read/write/edit）
   - 第二层：Exec 沙箱（JavaScript 编排）
   - 第三层：MCP 工具（Browser/Computer Use/自定义）

3. **模型适配策略**：不同模型对应不同的 skill 组合和工具集，通过 `mapping.json` 实现动态适配

4. **会话记忆系统**：每个项目有独立的记忆目录，记录会话历史、主题总结和经验学习

### 7.2 技术亮点

1. **Exec 沙箱设计**：
   - 隔离的 V8 上下文
   - 受限的全局变量（tools, text, exit, ALL_TOOLS）
   - 支持并行调用（Promise.all）
   - 错误恢复机制

2. **Browser 工具优化**：
   - ref 生命周期管理
   - 增量快照（compact snapshot）
   - 等待条件而非固定 sleep
   - 失败恢复策略

3. **Computer Use 精确控制**：
   - 分数坐标系统（0-1000）
   - 增量 UI 树更新
   - 截图按需启用
   - 确认政策（敏感操作需用户确认）

### 7.3 安全机制

1. **Exec 沙箱隔离**：无文件系统、无网络、无 require
2. **工具调用限制**：Exec 调用次数限制（30 次/10 分钟）
3. **敏感操作确认**：删除、支付、CAPTCHA 需用户确认
4. **密钥保护**：禁止在代码中硬编码密钥

---

## 8. 后续研究方向

### 8.1 短期优化

1. **实现 Exec 工具插件**：为 opencode 创建 JavaScript 沙箱工具
2. **集成 Playwright MCP**：启用浏览器自动化能力
3. **导出 Skill 文件**：将提取的 skill 转换为 opencode skills 格式

### 8.2 中期扩展

1. **会话记忆系统**：实现跨会话的持久化学习
2. **多模式支持**：Code Mode / Design Mode / Work Mode 切换
3. **Skill 热加载**：运行时动态加载 skill 文件

### 8.3 长期愿景

1. **完整协议还原**：逆向工程 HTTP/MCP 协议，实现完全兼容的 agent 实现
2. **模型适配层**：实现动态模型选择和 skill 适配
3. **分布式执行**：支持远程 agent 执行和任务分发

---

## 附录：文件清单

### 配置文件
- `C:\Users\narci\.trae-cn\builtin\baseline\catalog_manifests\trae.json` — Agent 类型和 skill 列表
- `C:\Users\narci\.trae-cn\builtin\baseline\catalog_manifests\mapping.json` — Agent 类型映射
- `C:\Users\narci\.trae-cn\builtin\baseline\catalog_manifests\global.json` — 全局配置

### Skill 文件
- `C:\Users\narci\.trae-cn\builtin\baseline\global\skills\TRAE-code-mode-orchestrator\SKILL.md`
- `C:\Users\narci\.trae-cn\builtin\baseline\global\skills\TRAE-browseruse\SKILL.md`
- `C:\Users\narci\.trae-cn\builtin\baseline\global\skills\TRAE-computer-use-ptc\SKILL.md`
- `C:\Users\narci\.trae-cn\builtin_skills\TRAE-debugger\SKILL.md`
- `C:\Users\narci\.trae-cn\builtin_skills\TRAE-code-review\SKILL.md`
- `C:\Users\narci\.trae-cn\builtin_skills\TRAE-security-review\SKILL.md`

### MCP 工具定义
- `C:\Users\narci\.trae-cn\mcps\s_*\solo_agent\integrated_code_mode\tools\Exec.json`
- `C:\Users\narci\.trae-cn\mcps\s_*\solo_agent\integrated_default\tools\*.json`

### 会话数据
- `C:\Users\narci\.trae-cn\memory\projects\*\session_memory_*.jsonl`
- `C:\Users\narci\.trae-cn\work\.trae\toolcall-output\*.txt`

---

**报告生成时间**: 2026-11-07  
**分析工具**: 配置文件读取 + 技能文件提取 + MCP 工具定义分析  
**逆向方法**: 配置驱动逆向（非二进制反编译）
