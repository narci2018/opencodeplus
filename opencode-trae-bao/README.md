# opencode-trae-bao

TRAE 宝（ByteDance 开发者个人助理）完整移植到 opencode。基于 Trae CN IDE v3.4.15+ 深度逆向分析。

## 功能

| 组件 | 说明 | 默认 |
|------|------|------|
| **TRAE 宝 agent** | 双助理模式（全局 + 项目）、多任务并行、结论式汇报 | 注册 |
| **跨会话记忆** | Chronicle：10分钟/6小时摘要窗口、OCR 屏幕捕获、隐私脱敏 | 关闭 |
| **IM 桥接** | 飞书（OIDC 设备码）/ 微信（QR）远程派任务、查进度 | 关闭 |
| **浮动宠物** | TUI 面板快捷键（`Alt+Shift+Space`）切换 | 开启 |

## 安装

把本目录注册为 opencode 本地插件。两种方式任选其一：

**方式 A：项目级配置（推荐，用于开发测试）**

在项目根目录的 `opencode.json` 添加：

```jsonc
{
  "plugins": ["C:/Tools2/opencodeplus/opencode-trae-bao"]
}
```

**方式 B：全局配置**

在 `~/.config/opencode/opencode.json`（或 `opencode.jsonc`）的 `plugins` 数组添加同路径。

## 配置

插件通过配置项定制（`opencode.json` 的 `plugins` 条目用对象形式）：

```jsonc
{
  "plugins": [
    {
      "package": "C:/Tools2/opencodeplus/opencode-trae-bao",
      "options": {
        "chronicle": { "enabled": true, "consentAccepted": true, "accountId": "your-user-id" },
        "imBridge": {
          "feishu": { "enabled": true, "domain": "feishu", "groupMentionPolicy": "everyone" },
          "wx": { "enabled": true }
        },
        "floatingChat": { "enabled": true, "shortcut": "Alt+Shift+Space" },
        "agent": { "maxParallelTasks": 4 }
      }
    }
  ]
}
```

### 配置项

| 路径 | 默认 | 说明 |
|------|------|------|
| `floatingChat.enabled` | `true` | 浮动宠物开关 |
| `floatingChat.shortcut` | `Alt+Shift+Space` | TUI 面板快捷键 |
| `floatingChat.size` | `1.0` | 缩放比例 |
| `chronicle.enabled` | `false` | 跨会话记忆（需同意） |
| `chronicle.consentAccepted` | `false` | 用户同意数据采集 |
| `chronicle.accountId` | `''` | 记忆隔离的账号 ID |
| `imBridge.feishu.enabled` | `false` | 飞书桥接（需凭据） |
| `imBridge.wx.enabled` | `false` | 微信桥接 |
| `agent.maxParallelTasks` | `4` | 并行子任务上限 |

## 使用

1. **切换 agent**：在 opencode agent 切换器中选择 **TRAE 宝**。
2. **浮动面板**：按 `Alt+Shift+Space` 或运行命令 `trae-bao` 切换。
3. **Chronicle 工具**：agent 运行时可用 `chronicle_status` / `chronicle_recent` / `chronicle_search` / `chronicle_get_memory`。
4. **IM 桥接**：配置凭据后，`loginFeishu` / `loginWechat` 启动对应桥接子进程。

## 验证

从 opencode 服务端确认插件与 agent 已加载：

```bash
# 项目根目录（含 opencode.json 插件配置）
opencode api agent.list --param 'location.directory=<项目目录>'
# 应包含 "id":"trae-bao"
```

## 已知限制

| 限制 | 影响 | 现状 |
|------|------|------|
| Chronicle 原为 macOS-only | Windows 需屏幕捕获 + OCR | 已用 screenshot-desktop + tesseract.js 适配 |
| 浮动宠物 TUI | server 插件 ctx 无 TUI keymap/ui | 可选链保护不崩溃；完整 TUI 需 TUI 插件形式 |
| 飞书 OAuth 需真实凭据 | 无凭据无法登录 | 子进程 spawn 正常，登录需凭据 |
| IM 桥接子进程 | 启动延迟 | 默认 disabled，需配置开启 |

## 开发

```bash
bun run typecheck   # 类型检查（插件本地代码 0 错误）
```

## 文档索引

- [移植总结](./移植总结.md)
