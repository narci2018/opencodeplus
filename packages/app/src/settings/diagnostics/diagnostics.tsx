import { Component, createSignal, createMemo, onMount, For, Show, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { TextField } from "@opencode/ui/text-field"
import { Switch } from "@opencode/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform, type NetworkEgress } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import { uuid } from "@opencode/util/uuid"
import "./diagnostics.css"

export type CustomHeader = {
  id: string
  key: string
  value: string
  enabled: boolean
  description?: string
}

const STORAGE_KEY = "opencode.custom_headers"

function loadStoredHeaders(): CustomHeader[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return []
}

function saveStoredHeaders(headers: CustomHeader[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(headers))
    // Sync active enabled headers to environment if in runtime
    const activeHeaders = Object.fromEntries(
      headers.flatMap((h) => (h.enabled && h.key.trim() ? [[h.key.trim(), h.value.trim()] as const] : [])),
    )

    if (typeof process !== "undefined" && process.env) {
      process.env.OPENCODE_CUSTOM_HEADERS = JSON.stringify(activeHeaders)
    }
  } catch {}
}

const HEADER_PRESETS = [
  { key: "X-Debug-Trace", value: "1", desc: "网关请求调试追踪" },
  { key: "X-Gateway-Route", value: "direct", desc: "内部路由指定" },
  { key: "X-Client-Tag", value: "opencode-plus", desc: "自定义客户端标签" },
  { key: "X-Custom-Env", value: "production", desc: "指定网关调用环境" },
]

export const SettingsDiagnostics: Component<{ headerAction?: JSX.Element }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()

  const [egress, setEgress] = createSignal<NetworkEgress | null>(null)
  const [checkingEgress, setCheckingEgress] = createSignal(false)
  const [customHeaders, setCustomHeaders] = createSignal<CustomHeader[]>(loadStoredHeaders())

  // New Header form inputs
  const [newKey, setNewKey] = createSignal("")
  const [newValue, setNewValue] = createSignal("")
  const [newDesc, setNewDesc] = createSignal("")

  // Client fingerprint state
  const [fingerprint, setFingerprint] = createSignal<{
    userAgent: string
    clientName: string
    version: string
    channel: string
    screenResolution: string
    timezone: string
    language: string
    platform: string
    hardwareConcurrency: number
    deviceMemory: number
    colorDepth: number
    pixelRatio: number
    id: string
  } | null>(null)

  const version = () => platform.version ?? "0.0.1-dev-01"
  const channel = () => "dev"
  const clientName = () => "desktop"
  const userAgent = createMemo(() => `opencode/${channel()}/${version()}/${clientName()}`)

  const checkEgress = async () => {
    if (!platform.checkEgress) {
      showToast({ variant: "default", title: "当前环境不支持直接探测出口 IP" })
      return
    }
    setCheckingEgress(true)
    try {
      const result = await platform.checkEgress()
      setEgress(result)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "出口检测完成",
        description: `当前出口 IP: ${result?.ip ?? "未知"}`,
      })
    } catch (e) {
      showToast({
        variant: "error",
        title: "出口检测失败",
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setCheckingEgress(false)
    }
  }

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "已复制到剪贴板",
        description: label,
      })
    })
  }

  const toggleHeader = (id: string, enabled: boolean) => {
    const updated = customHeaders().map((h) => (h.id === id ? { ...h, enabled } : h))
    setCustomHeaders(updated)
    saveStoredHeaders(updated)
  }

  const deleteHeader = (id: string) => {
    const updated = customHeaders().filter((h) => h.id !== id)
    setCustomHeaders(updated)
    saveStoredHeaders(updated)
    showToast({ variant: "default", title: "标头已删除" })
  }

  const addHeader = () => {
    const k = newKey().trim()
    const v = newValue().trim()
    if (!k) {
      showToast({ variant: "error", title: "请输入标头名称 (Header Key)" })
      return
    }
    const header: CustomHeader = {
      id: `hdr-${Date.now()}`,
      key: k,
      value: v,
      enabled: true,
      description: newDesc().trim() || undefined,
    }
    const updated = [...customHeaders(), header]
    setCustomHeaders(updated)
    saveStoredHeaders(updated)
    setNewKey("")
    setNewValue("")
    setNewDesc("")
    showToast({ variant: "success", icon: "circle-check", title: "标头已添加" })
  }

  const applyPreset = (preset: { key: string; value: string; desc: string }) => {
    setNewKey(preset.key)
    setNewValue(preset.value)
    setNewDesc(preset.desc)
  }

  const resetHeaders = () => {
    setCustomHeaders([])
    saveStoredHeaders([])
    showToast({ variant: "default", title: "已清空所有自定义标头" })
  }

  const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
  const randPick = <T,>(arr: T[]): T => arr[randInt(0, arr.length - 1)]

  const generateFingerprint = () => {
    const browsers = [
      { name: "Chrome", ver: () => `${randInt(120, 131)}.${randInt(0, 9)}.${randInt(1000, 9999)}.${randInt(100, 999)}` },
      { name: "Firefox", ver: () => `${randInt(125, 133)}.${randInt(0, 9)}` },
      { name: "Edge", ver: () => `${randInt(120, 131)}.${randInt(0, 9)}.${randInt(1000, 9999)}.${randInt(100, 999)}` },
      { name: "Safari", ver: () => `${randInt(17, 18)}.${randInt(0, 6)}.${randInt(0, 9)}` },
    ]
    const osList = [
      { name: "Windows NT 10.0", arch: "Win64; x64" },
      { name: "Windows NT 10.0", arch: "WOW64" },
      { name: "Macintosh; Intel Mac OS X 10_15_7", arch: "" },
      { name: "X11; Linux x86_64", arch: "" },
      { name: "X11; Ubuntu; Linux x86_64", arch: "" },
    ]
    const os = randPick(osList)
    const browser = randPick(browsers)
    const bv = browser.ver()
    const archPart = os.arch ? ` (${os.arch})` : ""
    const ua = `Mozilla/5.0 (${os.name}${archPart}) AppleWebKit/537.36 (KHTML, like Gecko) ${browser.name}/${bv} Safari/537.36`

    const channels = ["dev", "beta", "stable", "nightly", "canary", "rc"]
    const clientNames = ["desktop", "web", "mobile", "cli", "tui", "extension"]
    const resolutions = ["1920x1080", "2560x1440", "3840x2160", "1366x768", "1440x900", "1536x864", "1280x720", "2560x1600"]
    const timezones = [
      "Asia/Shanghai", "America/New_York", "Europe/London", "Asia/Tokyo",
      "America/Los_Angeles", "Europe/Berlin", "Australia/Sydney", "Asia/Singapore",
    ]
    const langs = ["zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE", "fr-FR", "zh-TW", "en-GB"]
    const platforms = ["Win32", "MacIntel", "Linux x86_64", "WebGL API"]
    const memories = [4, 8, 16, 32]
    const concurrencies = [2, 4, 6, 8, 12, 16]
    const depths = [24, 30, 48]
    const ratios = [1, 1.25, 1.5, 2, 2.5, 3]

    const fp = {
      userAgent: ua,
      clientName: randPick(clientNames),
      version: `${randInt(0, 9)}.${randInt(0, 9)}.${randInt(0, 99)}-dev-${randInt(1, 99)}`,
      channel: randPick(channels),
      screenResolution: randPick(resolutions),
      timezone: randPick(timezones),
      language: randPick(langs),
      platform: randPick(platforms),
      hardwareConcurrency: randPick(concurrencies),
      deviceMemory: randPick(memories),
      colorDepth: randPick(depths),
      pixelRatio: randPick(ratios),
      id: uuid(),
    }
    setFingerprint(fp)
    showToast({
      variant: "success",
      icon: "reset",
      title: "已生成随机客户端指纹",
      description: `UA: ${ua.slice(0, 60)}…`,
    })
  }

  // Initial egress check
  onMount(() => {
    if (platform.checkEgress) void checkEgress()
  })

  return (
    <div class="diagnostics-screen" data-action="settings-diagnostics">
      <div class="diagnostics-header">
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
          <div>
            <h1 class="diagnostics-title">{language.t("settings.diagnostics.title")}</h1>
            <p class="diagnostics-description">{language.t("settings.diagnostics.description")}</p>
          </div>
          <Show when={props.headerAction}>{props.headerAction}</Show>
        </div>
      </div>

      {/* 1. 客户端标识与环境诊断 (只读查看) */}
      <div class="diagnostics-section">
        <div class="diagnostics-section-header">
          <div>
            <div class="diagnostics-section-title">
              <Icon name="monitor" size="small" />
              <span>客户端标识与运行环境（只读预览）</span>
            </div>
            <div class="diagnostics-section-desc">当前客户端向模型服务端与控制台发出的标准身份与运行标识</div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="outline" size="small" onClick={generateFingerprint}>
              <Icon name="reset" size="small" />
              <span>随机生成客户端指纹</span>
            </Button>
            <Button variant="outline" size="small" onClick={() => copyText(userAgent(), "User-Agent")}>
              复制 UA
            </Button>
          </div>
        </div>

        <div class="diagnostics-grid">
          <div class="diagnostics-info-card">
            <span class="diagnostics-info-label">完整 User-Agent</span>
            <div class="diagnostics-info-value">
              <span style={{ "word-break": "break-all" }}>{fingerprint()?.userAgent ?? userAgent()}</span>
              <Show when={fingerprint()}>
                <IconButton
                  icon="copy"
                  size="small"
                  variant="ghost"
                  onClick={() => copyText(fingerprint()!.userAgent, "指纹 User-Agent")}
                  aria-label="复制指纹 UA"
                />
              </Show>
            </div>
          </div>

          <div class="diagnostics-info-card">
            <span class="diagnostics-info-label">客户端类型与版本</span>
            <div class="diagnostics-info-value">
              <span>{fingerprint() ? `${fingerprint()!.clientName} · v${fingerprint()!.version} (${fingerprint()!.channel})` : `${clientName()} · v${version()} (${channel()})`}</span>
            </div>
          </div>

          <Show when={fingerprint()}>
            <div class="diagnostics-info-card">
              <span class="diagnostics-info-label">屏幕分辨率</span>
              <div class="diagnostics-info-value">
                <span>{fingerprint()!.screenResolution}</span>
              </div>
            </div>
            <div class="diagnostics-info-card">
              <span class="diagnostics-info-label">时区 / 语言</span>
              <div class="diagnostics-info-value">
                <span>{fingerprint()!.timezone} · {fingerprint()!.language}</span>
              </div>
            </div>
            <div class="diagnostics-info-card">
              <span class="diagnostics-info-label">平台 / 硬件线程</span>
              <div class="diagnostics-info-value">
                <span>{fingerprint()!.platform} · {fingerprint()!.hardwareConcurrency} 核</span>
              </div>
            </div>
            <div class="diagnostics-info-card">
              <span class="diagnostics-info-label">设备内存 / 色深 / 像素比</span>
              <div class="diagnostics-info-value">
                <span>{fingerprint()!.deviceMemory} GB · {fingerprint()!.colorDepth}-bit · {fingerprint()!.pixelRatio}x</span>
              </div>
            </div>
          </Show>

          <div class="diagnostics-info-card">
            <span class="diagnostics-info-label">网络出口 IP 状态</span>
            <div class="diagnostics-info-value">
              <span>{egress()?.ip ?? (checkingEgress() ? "检测中…" : "未检测")}</span>
              <Button variant="ghost" size="small" disabled={checkingEgress()} onClick={checkEgress}>
                <Icon name="refresh" size="small" />
                <span>刷新</span>
              </Button>
            </div>
          </div>

          <div class="diagnostics-info-card">
            <span class="diagnostics-info-label">网络代理配置</span>
            <div class="diagnostics-info-value">
              <span>{egress()?.proxy.http || egress()?.proxy.https ? "已启用网络代理" : "直连访问"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. 默认请求标头明细 */}
      <div class="diagnostics-section">
        <div class="diagnostics-section-header">
          <div>
            <div class="diagnostics-section-title">
              <Icon name="list-ordered" size="small" />
              <span>模型调用标准标头（Default Headers）</span>
            </div>
            <div class="diagnostics-section-desc">调用免费模型或云端网关时由本地 Core 引擎自动附加的标准 HTTP 标头</div>
          </div>
        </div>

        <table class="diagnostics-headers-table">
          <thead>
            <tr>
              <th style={{ width: "220px" }}>标头名称 (Header Key)</th>
              <th>当前值 (Value)</th>
              <th style={{ width: "160px" }}>类型与说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>User-Agent</code></td>
              <td><code>{userAgent()}</code></td>
              <td><span class="diagnostics-header-badge">核心版本标识</span></td>
            </tr>
            <tr>
              <td><code>x-opencode-client</code></td>
              <td><code>{clientName()}</code></td>
              <td><span class="diagnostics-header-badge">宿主模式</span></td>
            </tr>
            <tr>
              <td><code>x-opencode-project</code></td>
              <td><code>prj_active_workspace</code></td>
              <td><span class="diagnostics-header-badge">工程上下文哈希</span></td>
            </tr>
            <tr>
              <td><code>x-session-affinity</code></td>
              <td><code>ses_affinity_hash (动态)</code></td>
              <td><span class="diagnostics-header-badge">KV 缓存路由</span></td>
            </tr>
            <tr>
              <td><code>Authorization</code></td>
              <td><code>Bearer public (匿名免费)</code></td>
              <td><span class="diagnostics-header-badge">调用凭证</span></td>
            </tr>
            <tr>
              <td><code>Content-Type</code></td>
              <td><code>application/json</code></td>
              <td><span class="diagnostics-header-badge">数据格式</span></td>
            </tr>
            <tr>
              <td><code>Accept</code></td>
              <td><code>text/event-stream</code></td>
              <td><span class="diagnostics-header-badge">SSE 流式协议</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3. 自定义请求头管理 (Custom Request Headers) */}
      <div class="diagnostics-section">
        <div class="diagnostics-section-header">
          <div>
            <div class="diagnostics-section-title">
              <Icon name="sliders" size="small" />
              <span>自定义请求头管理（Custom Request Headers）</span>
            </div>
            <div class="diagnostics-section-desc">配置随每次模型请求额外附加的 HTTP 标头，用于测试、企业内网鉴权或网关路由追踪</div>
          </div>
          <Show when={customHeaders().length > 0}>
            <Button variant="ghost" size="small" onClick={resetHeaders}>
              清空自定义标头
            </Button>
          </Show>
        </div>

        {/* 现有自定义 Headers 列表 */}
        <Show
          when={customHeaders().length > 0}
          fallback={
            <div style={{ padding: "16px", "text-align": "center", color: "var(--v2-text-text-muted)", "font-size": "13px" }}>
              暂未添加自定义标头。你可以在下方添加需要的测试标头或选择推荐预设。
            </div>
          }
        >
          <table class="diagnostics-headers-table">
            <thead>
              <tr>
                <th style={{ width: "50px" }}>启用</th>
                <th style={{ width: "200px" }}>标头名称</th>
                <th>标头值</th>
                <th style={{ width: "160px" }}>说明</th>
                <th style={{ width: "60px", "text-align": "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              <For each={customHeaders()}>
                {(header) => (
                  <tr>
                    <td>
                      <Switch checked={header.enabled} onChange={(val) => toggleHeader(header.id, val)} />
                    </td>
                    <td>
                      <code>{header.key}</code>
                      <span class="diagnostics-header-badge" data-variant="custom" style={{ "margin-left": "6px" }}>
                        自定义
                      </span>
                    </td>
                    <td>
                      <code style={{ "word-break": "break-all" }}>{header.value}</code>
                    </td>
                    <td style={{ color: "var(--v2-text-text-muted)" }}>{header.description || "—"}</td>
                    <td style={{ "text-align": "right" }}>
                      <IconButton
                        icon="trash"
                        size="small"
                        variant="ghost"
                        onClick={() => deleteHeader(header.id)}
                        aria-label="删除标头"
                      />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>

        {/* 添加自定义标头表单 */}
        <div class="diagnostics-custom-form">
          <div style={{ "font-size": "13px", "font-weight": "500", color: "var(--v2-text-text-base)" }}>
            添加自定义 HTTP 标头
          </div>

          <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "10px" }}>
            <TextField
              label="标头名称 (Header Key)"
              placeholder="例如：X-Debug-Trace"
              value={newKey()}
              onChange={setNewKey}
            />
            <TextField
              label="标头值 (Header Value)"
              placeholder="例如：my-trace-value"
              value={newValue()}
              onChange={setNewValue}
            />
          </div>

          <TextField
            label="备注说明 (选填)"
            placeholder="说明此标头的用途"
            value={newDesc()}
            onChange={setNewDesc}
          />

          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-top": "4px" }}>
            <div class="diagnostics-custom-presets">
              <span style={{ "font-size": "12px", color: "var(--v2-text-text-muted)" }}>快速预设:</span>
              <For each={HEADER_PRESETS}>
                {(preset) => (
                  <button type="button" class="diagnostics-preset-chip" onClick={() => applyPreset(preset)}>
                    {preset.key}
                  </button>
                )}
              </For>
            </div>
            <Button variant="contrast" size="small" onClick={addHeader}>
              <Icon name="plus" size="small" />
              <span>添加标头</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
