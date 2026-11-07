# Trae CN Agent 架构可视化

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                     Trae CN IDE (v3.4.15)                       │
│                     Electron + VS Code Fork                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Orchestrator                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Solo Agent  │  │ Code Mode   │  │ Design Mode │             │
│  │ (通用任务)   │  │ (代码任务)   │  │ (设计任务)   │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         └─────────────────┼─────────────────┘                   │
│                           ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Skill-Based Decision Engine                 │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │ Pre-Activation│  │ Tool Selection│  │ Execution     │  │   │
│  │  │ Gate         │  │ & Routing    │  │ Strategy     │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Tool Execution Layer                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Standard    │  │    Exec      │  │    MCP       │         │
│  │  Tools       │  │  (V8 Sandbox)│  │   Servers    │         │
│  │              │  │              │  │              │         │
│  │  • Read      │  │  • JS Code   │  │  • Browser   │         │
│  │  • Write     │  │  • Promise   │  │    Use       │         │
│  │  • Edit      │  │    .all()    │  │  • Computer  │         │
│  │  • Search    │  │  • text()    │  │    Use       │         │
│  │  • Shell     │  │  • exit()    │  │  • Schedule  │         │
│  │              │  │              │  │  • Generate  │         │
│  └──────────────┘  └──────────────┘  │    Image     │         │
│                                      │  • Generate  │         │
│                                      │    Video     │         │
│                                      └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Memory System                           │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │ Session Memory   │  │ Project Memory   │                    │
│  │ (per-conversation)│ │ (persistent)     │                    │
│  │                  │  │                  │                    │
│  │ • intent         │  │ • learned        │                    │
│  │ • actions        │  │ • topics         │                    │
│  │ • outcome        │  │ • profile        │                    │
│  │ • learned        │  │                  │                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

## 工具调用流程

### 1. 标准工具调用（简单任务）
```
用户请求 → Agent 决策 → 直接工具调用 → 结果返回
```

### 2. Exec 沙箱调用（复杂编排）
```
用户请求 → Agent 决策 → 生成 JS 代码 → Exec 执行
                                    ↓
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
                tools.a()       tools.b()      tools.c()
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                              text(result) → 返回给用户
```

### 3. Browser 工具调用
```
用户请求 → 加载 TRAE-browseruse Skill → Exec 内调用
                                    ↓
                    browser_navigate()
                    browser_snapshot()
                    browser_click()
                        │
                        ▼
                  返回页面状态
```

### 4. Computer Use 工具调用
```
用户请求 → 加载 TRAE-computer-use-ptc Skill → Exec 内调用
                                    ↓
                    cu("list_apps")
                    cu("get_app_state")
                    cu("click", {...})
                        │
                        ▼
                  返回 UI 状态/截图
```

## Skill 加载流程

```
Agent 启动
    │
    ├─ 加载 mapping.json（Agent 类型映射）
    │
    ├─ 根据模型选择配置
    │   ├─ GPT 系列 → gpt 配置
    │   ├─ DeepSeek → non_multimodal 配置
    │   └─ Doubao → seed/doutops 配置
    │
    ├─ 下载/缓存 Skill ZIP
    │   └─ CDN: p11-market.byteimg.com
    │
    ├─ 解压到 ~/.trae-cn/builtin_skills/
    │
    ├─ 解析 SKILL.md 文件
    │   ├─ YAML frontmatter（name, description, user_invocable）
    │   └─ Markdown 正文（使用指南）
    │
    └─ 注册到 Agent 上下文
        ├─ user_invocable: false → 自动加载
        └─ user_invocable: true → 按需加载
```

## 决策树示例

### Code Mode 决策
```
请求: "搜索 8 个关键词，去重，写报告"
    │
    ├─ 是否涉及 fan-out? ✓ (8 个关键词并行搜索)
    ├─ 是否涉及数据转换? ✓ (去重 + 排序)
    ├─ 是否涉及验证? ✓ (检查输出文件)
    │
    └─ 决策: 使用 Code Mode (Exec)
        │
        └─ 生成 JavaScript:
           const results = await Promise.all(
             keywords.map(k => tools.WebSearch(k))
           );
           const deduped = deduplicate(results);
           await tools.Write("report.md", format(deduped));
           text({ status: "completed", items: deduped.length });
```

### Debugger 激活决策
```
请求: "应用崩溃了，帮我看看"
    │
    ├─ Pre-Activation Intent Gate
    │   └─ 用户明确要求调试? ✗ (仅描述症状)
    │
    └─ 不激活 TRAE-debugger
        └─ 使用普通工作流处理
```

```
请求: "帮我调试登录 500 错误的根因"
    │
    ├─ Pre-Activation Intent Gate ✓
    ├─ Pre-Activation Selection Gate ✓ (无专用调试 Skill)
    ├─ Pre-Activation Complexity Gate ✓ (需要运行时证据)
    │
    └─ 激活 TRAE-debugger
        ├─ 生成 Session ID: login-500-error
        ├─ 创建 debug-login-500-error.md
        ├─ 列出假设:
        │   1. 数据库连接超时
        │   2. 认证服务不可用
        │   3. 请求参数验证失败
        └─ 插入日志代码（不修改业务逻辑）
```

## 记忆系统架构

```
~/.trae-cn/memory/
├── user_profile.md                    # 用户级偏好
└── projects/
    └── <project-id>/
        ├── project_memory.md          # 项目级持久记忆
        ├── topics.md                  # 主题总结
        └── 2026-11-07/
            ├── session_memory_*.jsonl # 会话记忆（JSONL）
            └── ...
```

### 记忆条目结构
```json
{
  "intent": "用户意图描述",
  "actions": ["执行的动作列表"],
  "outcome": "执行结果",
  "learned": ["学到的经验"],
  "message_summary_time": "2026-11-07 10:00:00",
  "message_id": "unique-id",
  "compact_summary_meta": {
    "trigger": "auto",
    "mode": "async",
    "summary_digest": "sha256-hash"
  }
}
```

## 网络架构

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Trae CN    │────▶│ 字节内部网关  │────▶│  API 服务   │
│  IDE        │     │ (gator)      │     │ (MCS)       │
└─────────────┘     └──────────────┘     └─────────────┘
       │                                      │
       │                                      ▼
       │                             ┌─────────────┐
       │                             │ Skill CDN   │
       │                             │ (byteimg)   │
       │                             └─────────────┘
       │                                      │
       │                                      ▼
       │                             ┌─────────────┐
       └────────────────────────────▶│ Model API   │
                                      │ (Claude/    │
                                      │  GPT/       │
                                      │  DeepSeek)  │
                                        └─────────────┘
```

## 安全机制

### Exec 沙箱隔离
```
┌──────────────────┐
│   V8 Sandbox     │
├──────────────────┤
│ ✅ tools         │  ← 工具调用代理
│ ✅ ALL_TOOLS     │  ← 工具列表（只读）
│ ✅ text()        │  ← 输出函数
│ ✅ exit()        │  ← 终止函数
│ ✅ image()       │  ← 截图处理
├──────────────────┤
│ ❌ require()     │  ← 禁止
│ ❌ process       │  ← 禁止
│ ❌ fetch         │  ← 禁止
│ ❌ console       │  ← 禁止
│ ❌ setTimeout    │  ← 禁止
│ ❌ fs            │  ← 禁止
└──────────────────┘
```

### 敏感操作确认政策
```
┌─────────────────────────────────────────────────────┐
│           Computer Use 确认政策                      │
├─────────────────────────────────────────────────────┤
│ 🔴 必须确认:                                       │
│   • 删除数据（本地/云端）                           │
│   • 互联网权限/账户修改                             │
│   • 解决 CAPTCHA                                   │
│   • 安装/运行新软件                                 │
│   • 财务交易                                       │
│                                                     │
│ 🟡 可预授权:                                       │
│   • 下载文件（入站传输）                            │
│   • 上传文件                                       │
│   • 文件管理（同云内移动/重命名）                    │
│                                                     │
│ 🟢 无需确认:                                       │
│   • 只读操作（读取、查询、分析）                    │
│   • 非敏感范围的 GUI 操作                           │
└─────────────────────────────────────────────────────┘
```

---

**图例说明**：
- 实线箭头：数据流/控制流
- 虚线框：逻辑分组
- 颜色标记：操作类型（🔴危险/🟡警告/🟢安全）
