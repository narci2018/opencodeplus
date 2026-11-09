import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { TextField } from "@opencode/ui/text-field"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useTabs } from "@/shell/tabs/tabs"
import { ServerConnection } from "@/runtime/server/registry"
import { useSettingsSurface } from "../surface"
import { showToast } from "@/shell/notifications/toast"
import { TEMPLATE_CATEGORIES, TEMPLATES_DATA, type TemplateItem } from "./catalog"
import "./templates.css"

export function SettingsTemplates(props: { headerAction?: JSX.Element }) {
  const language = useLanguage()
  const dialog = useDialog()
  const tabs = useTabs()
  const surface = useSettingsSurface()

  const [category, setCategory] = createSignal<string>("全部")
  const [search, setSearch] = createSignal<string>("")

  const filteredTemplates = createMemo(() => {
    const currentCat = category()
    const query = search().trim().toLowerCase()

    return TEMPLATES_DATA.filter((item) => {
      if (currentCat !== "全部" && item.category !== currentCat) return false
      if (!query) return true
      return (
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.tags.some((t) => t.toLowerCase().includes(query))
      )
    })
  })

  const openUseTemplate = (template: TemplateItem) => {
    dialog.push(() => (
      <UseTemplateDialog
        template={template}
        onUse={(prompt, agent) => {
          dialog.close()
          surface.close()
          const activeServer = (surface.server()?.key ?? "") as ServerConnection.Key
          void tabs.newDraft({ server: activeServer, directory: "" }, prompt)
          showToast({
            variant: "success",
            icon: "circle-check",
            title: "已加载模板",
            description: `模板“${template.title}”已载入新会话，智能体推荐：${agent}。`,
          })
        }}
        onClose={() => dialog.close()}
      />
    ))
  }

  return (
    <div class="templates-screen">
      <div class="templates-header">
        <div class="templates-header-main">
          <div class="templates-title">{language.t("settings.templates.title")}</div>
          <div class="templates-description">{language.t("settings.templates.description")}</div>
        </div>
        <Show when={props.headerAction}>{props.headerAction}</Show>
      </div>

      <div class="templates-controls">
        <div class="templates-categories">
          <For each={TEMPLATE_CATEGORIES}>
            {(cat) => (
              <button
                type="button"
                class="templates-category-btn"
                data-active={category() === cat}
                onClick={() => setCategory(cat)}
              >
                {cat}
              </button>
            )}
          </For>
        </div>

        <div class="templates-search">
          <TextField
            value={search()}
            onChange={setSearch}
            placeholder="搜索模板、标签或关键词…"
            icon="magnifying-glass"
          />
        </div>
      </div>

      <div class="templates-grid">
        <For each={filteredTemplates()}>
          {(template) => (
            <div class="template-card">
              <div class="template-card-top">
                <div class="template-card-header">
                  <span class="template-card-title">{template.title}</span>
                  <span class="template-format-badge">{template.format}</span>
                </div>
                <div class="template-card-desc">{template.description}</div>
                <div class="template-tags">
                  <For each={template.tags}>{(tag) => <span class="template-tag">#{tag}</span>}</For>
                </div>
              </div>

              <div class="template-card-bottom">
                <div class="template-agent-badge">
                  <Icon name="agents" size="small" />
                  <span>推荐: {template.agent.toUpperCase()}</span>
                </div>
                <Button variant="contrast" size="small" onClick={() => openUseTemplate(template)}>
                  一键开始
                </Button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function UseTemplateDialog(props: {
  template: TemplateItem
  onUse: (prompt: string, agent: string) => void
  onClose: () => void
}) {
  const [prompt, setPrompt] = createSignal(props.template.promptTemplate)
  const [agent, setAgent] = createSignal(props.template.agent)

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitleGroup title={`使用模板：${props.template.title}`} description={props.template.description} />
      </DialogHeader>
      <DialogBody>
        <div class="template-dialog-body">
          <div style={{ display: "flex", "align-items": "center", gap: "16px" }}>
            <span style={{ "font-size": "13px", "font-weight": "500", color: "var(--v2-text-text-base)" }}>
              执行智能体:
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              {(["trae", "trae-bao", "build"] as const).map((a) => (
                <button
                  type="button"
                  class="templates-category-btn"
                  data-active={agent() === a}
                  onClick={() => setAgent(a)}
                >
                  {a.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <span style={{ "font-size": "13px", "font-weight": "500", color: "var(--v2-text-text-base)" }}>
              提示词与任务参数（可自由调整）：
            </span>
            <textarea
              class="template-prompt-preview"
              rows={12}
              value={prompt()}
              onInput={(e) => setPrompt(e.currentTarget.value)}
            />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={props.onClose}>
          取消
        </Button>
        <Button variant="contrast" onClick={() => props.onUse(prompt(), agent())}>
          立即创建会话并执行
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
