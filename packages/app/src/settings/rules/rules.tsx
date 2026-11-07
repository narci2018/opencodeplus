import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { Select } from "@opencode/ui/select"
import { TextField } from "@opencode/ui/text-field"
import { Switch } from "@opencode/ui/switch"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { showToast } from "@/shell/notifications/toast"
import {
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  type Component,
  type JSX,
} from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import "@/settings/usage/usage.css"
import "./rules.css"

type FileRef = { path: string; content: string | null }

type Scope = "global" | "project"

const encoder = new TextEncoder()


export const SettingsRules: Component<{ headerAction?: JSX.Element }> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const dialog = useDialog()

  const [rulesScope, setRulesScope] = createSignal<Scope>("global")
  const [memoryScope, setMemoryScope] = createSignal<Scope>("global")
  const [projectID, setProjectID] = createSignal<string | undefined>(undefined)

  const connected = () => sdk.connection.status() === "connected"

  // First fetch lists every project's memory directory; the scoped fetch then resolves the
  // selected project's rule and memory files.
  const [bootstrap] = createResource(connected, async () => {
    if (!connected()) return undefined
    return sdk.api.experimental.rules.files().catch(() => undefined)
  })

  const [files, filesActions] = createResource(
    () => [connected(), projectID()] as const,
    async ([active, id]) => {
      if (!active) return undefined
      const directory = (bootstrap.latest?.memory.projects ?? []).find((item) => item.projectID === id)?.directory
      const result = await sdk.api.experimental.rules
        .files(directory ? { location: { directory } } : undefined)
        .catch(() => undefined)
      return result
    },
  )

  const refresh = () => void filesActions.refetch()

  // Toggles flip optimistically; a failed write rolls the optimistic value back.
  const [ruleOverrides, setRuleOverrides] = createSignal<Partial<{ agents_md: boolean; claude_md: boolean }> | undefined>(
    undefined,
  )
  const [memoryOverrides, setMemoryOverrides] = createSignal<Partial<{ enabled: boolean; distill: boolean }> | undefined>(
    undefined,
  )

  const rulesState = createMemo(() => ({
    agents_md: ruleOverrides()?.agents_md ?? files.latest?.rules.agents_md ?? true,
    claude_md: ruleOverrides()?.claude_md ?? files.latest?.rules.claude_md ?? false,
  }))
  const memoryState = createMemo(() => ({
    enabled: memoryOverrides()?.enabled ?? files.latest?.memory.enabled ?? true,
    distill: memoryOverrides()?.distill ?? files.latest?.memory.distill ?? true,
  }))

  const patch = async (
    patchBody: Record<string, unknown>,
    onOptimistic: () => void,
    onRollback: () => void,
  ) => {
    onOptimistic()
    try {
      await sdk.api.experimental.config.update(patchBody as never)
      setRuleOverrides(undefined)
      setMemoryOverrides(undefined)
      refresh()
    } catch (cause) {
      onRollback()
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    }
  }

  const projects = createMemo(() => bootstrap.latest?.memory.projects ?? [])
  const projectOptions = createMemo(() => projects().map((item) => ({ id: item.projectID, label: item.name })))
  const projectName = (id: string) => projectOptions().find((option) => option.id === id)?.label ?? id

  const scopeProjectID = () => {
    if (projectID() && projects().some((item) => item.projectID === projectID())) return projectID()
    return projects()[0]?.projectID
  }

  const editFile = (file: FileRef) => {
    void dialog.show(
      () => (
        <FileEditDialog
          title={language.t("settings.rules.file.edit.title", { name: file.path })}
          path={file.path}
          content={file.content ?? ""}
          onSaved={() => refresh()}
          onClose={() => dialog.close()}
        />
      ),
      () => undefined,
    )
  }

  const addInstruction = () => {
    void dialog.show(
      () => (
        <SourceAddDialog
          onSaved={() => refresh()}
          onClose={() => dialog.close()}
        />
      ),
      () => undefined,
    )
  }

  const removeInstruction = async (source: string) => {
    try {
      await sdk.api.experimental.config.update({ instruction: { source, remove: true } })
      refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.extensions.removed.title"),
        description: language.t("settings.extensions.removed.description", { name: source }),
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    }
  }

  const scopeTabs = (value: Scope, set: (next: Scope) => void) => (
    <div class="usage-range" role="group">
      <Button size="small" variant={value === "global" ? "contrast" : "ghost-muted"} onClick={() => set("global")}>
        {language.t("settings.rules.scope.global")}
      </Button>
      <Button size="small" variant={value === "project" ? "contrast" : "ghost-muted"} onClick={() => set("project")}>
        {language.t("settings.rules.scope.project")}
      </Button>
    </div>
  )

  return (
    <div class="settings-tab-body">
      <div class="settings-tab-header settings-tab-header--stacked">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.rules.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.rules.description")}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
      </div>

      <Show
        when={!files.error}
        fallback={
          <div class="usage-status" role="alert">
            <Icon name="circle-exclamation" size="small" />
            <span>{language.t("settings.rules.error")}</span>
            <Button size="small" variant="ghost-muted" onClick={refresh}>
              {language.t("settings.usage.retry")}
            </Button>
          </div>
        }
      >
        <Show when={!files.loading} fallback={
          <div class="usage-status">
            <Loader class="usage-status-spinner" />
            <span>{language.t("settings.usage.loading")}</span>
          </div>
        }>
          <div class="usage-section">
            <span class="usage-section-title">{language.t("settings.rules.imports")}</span>
            <div class="rules-rows">
              <div class="rules-row">
                <div class="rules-row-copy">
                  <span class="rules-row-title">{language.t("settings.rules.imports.agents.title")}</span>
                  <span class="rules-row-description">{language.t("settings.rules.imports.agents.description")}</span>
                </div>
                <Switch
                  checked={rulesState().agents_md}
                  onChange={(checked) =>
                    void patch(
                      { rules: { agents_md: checked === true } },
                      () => setRuleOverrides({ ...ruleOverrides(), agents_md: checked === true }),
                      () => setRuleOverrides(undefined),
                    )
                  }
                />
              </div>
              <div class="rules-row">
                <div class="rules-row-copy">
                  <span class="rules-row-title">{language.t("settings.rules.imports.claude.title")}</span>
                  <span class="rules-row-description">{language.t("settings.rules.imports.claude.description")}</span>
                </div>
                <Switch
                  checked={rulesState().claude_md}
                  onChange={(checked) =>
                    void patch(
                      { rules: { claude_md: checked === true } },
                      () => setRuleOverrides({ ...ruleOverrides(), claude_md: checked === true }),
                      () => setRuleOverrides(undefined),
                    )
                  }
                />
              </div>
            </div>
          </div>

          <div class="usage-section">
            <div class="usage-section-row">
              <span class="usage-section-title">{language.t("settings.rules.section")}</span>
              <div class="flex items-center gap-2">
                {scopeTabs(rulesScope(), setRulesScope)}
                <IconButton
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  aria-label={language.t("common.refresh")}
                  onClick={refresh}
                  icon={<Icon name="reset" size="small" />}
                />
              </div>
            </div>
            <Show
              when={rulesScope() === "global"}
              fallback={
                <Show when={scopeProjectID()} fallback={
                  <div class="usage-status">{language.t("settings.rules.empty.projects")}</div>
                }>
                  <div class="rules-rows">
                    <div class="rules-row">
                      <ProjectSelect
                        projects={projects()}
                        projectID={scopeProjectID()}
                        onSelect={setProjectID}
                      />
                      <div class="rules-row-copy">
                        <span class="rules-row-title">{projectName(scopeProjectID()!)}</span>
                        <span class="rules-row-description rules-row-path">
                          {files.latest?.projectAgents?.path ?? "—"}
                        </span>
                      </div>
                      <Show when={files.latest?.projectAgents}>
                        {(file) => (
                          <Button size="small" variant="ghost-muted" onClick={() => editFile(file())}>
                            {file().content !== null
                              ? language.t("common.edit")
                              : language.t("settings.rules.file.create")}
                          </Button>
                        )}
                      </Show>
                    </div>
                  </div>
                </Show>
              }
            >
              <div class="rules-rows">
                <div class="rules-row">
                  <div class="rules-row-copy">
                    <span class="rules-row-title">{language.t("settings.rules.file.globalAgents")}</span>
                    <span class="rules-row-description rules-row-path">
                      {files.latest?.globalAgents.path ?? "—"}
                    </span>
                  </div>
                  <Button size="small" variant="ghost-muted" onClick={() => editFile(files.latest!.globalAgents)}>
                    {files.latest?.globalAgents.content !== null
                      ? language.t("common.edit")
                      : language.t("settings.rules.file.create")}
                  </Button>
                </div>
              </div>
              <div class="rules-rows">
                <div class="rules-section-sub">
                  <span class="usage-section-title">{language.t("settings.rules.sources")}</span>
                  <Button size="small" variant="ghost-muted" icon="plus" onClick={addInstruction}>
                    {language.t("settings.rules.sources.add")}
                  </Button>
                </div>
                <Show when={(files.latest?.instructions ?? []).length > 0} fallback={
                  <div class="usage-status">{language.t("settings.rules.sources.empty")}</div>
                }>
                  <For each={files.latest?.instructions ?? []}>
                    {(source) => (
                      <div class="rules-row">
                        <div class="rules-row-copy">
                          <span class="rules-row-description rules-row-path">{source}</span>
                        </div>
                        <Button
                          size="small"
                          variant="ghost-muted"
                          aria-label={language.t("common.delete")}
                          onClick={() => void removeInstruction(source)}
                        >
                          <Icon name="trash" size="small" />
                        </Button>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>

          <div class="usage-section">
            <div class="usage-section-row">
              <span class="usage-section-title">
                {language.t("settings.rules.memory.section")}
                <span class="rules-beta">Beta</span>
              </span>
              {scopeTabs(memoryScope(), setMemoryScope)}
            </div>
            <div class="rules-rows">
              <div class="rules-row">
                <div class="rules-row-copy">
                  <span class="rules-row-title">{language.t("settings.rules.memory.toggle.title")}</span>
                  <span class="rules-row-description">{language.t("settings.rules.memory.toggle.description")}</span>
                </div>
                <Switch
                  checked={memoryState().enabled}
                  onChange={(checked) =>
                    void patch(
                      { memory: { enabled: checked === true } },
                      () => setMemoryOverrides({ ...memoryOverrides(), enabled: checked === true }),
                      () => setMemoryOverrides(undefined),
                    )
                  }
                />
              </div>
              <div class="rules-row">
                <div class="rules-row-copy">
                  <span class="rules-row-title">{language.t("settings.rules.memory.distill.title")}</span>
                  <span class="rules-row-description">{language.t("settings.rules.memory.distill.description")}</span>
                </div>
                <Switch
                  checked={memoryState().distill}
                  disabled={!memoryState().enabled}
                  onChange={(checked) =>
                    void patch(
                      { memory: { distill: checked === true } },
                      () => setMemoryOverrides({ ...memoryOverrides(), distill: checked === true }),
                      () => setMemoryOverrides(undefined),
                    )
                  }
                />
              </div>
            </div>
            <Show
              when={memoryScope() === "global"}
              fallback={
                <Show when={scopeProjectID()} fallback={
                  <div class="usage-status">{language.t("settings.rules.empty.projects")}</div>
                }>
                  <div class="rules-rows">
                    <div class="rules-row">
                      <ProjectSelect
                        projects={projects()}
                        projectID={scopeProjectID()}
                        onSelect={setProjectID}
                      />
                      <div class="rules-row-copy">
                        <span class="rules-row-title">{language.t("settings.rules.memory.project")}</span>
                        <span class="rules-row-description rules-row-path">
                          {files.latest?.memory.project?.path ?? "—"}
                        </span>
                      </div>
                      <Show when={files.latest?.memory.project}>
                        {(file) => (
                          <Button size="small" variant="ghost-muted" onClick={() => editFile(file())}>
                            {file().content !== null ? language.t("common.edit") : language.t("settings.rules.file.create")}
                          </Button>
                        )}
                      </Show>
                    </div>
                  </div>
                </Show>
              }
            >
              <div class="rules-rows">
                <div class="rules-row">
                  <div class="rules-row-copy">
                    <span class="rules-row-title">{language.t("settings.rules.memory.global")}</span>
                    <span class="rules-row-description rules-row-path">{files.latest?.memory.global.path ?? "—"}</span>
                  </div>
                  <Button size="small" variant="ghost-muted" onClick={() => editFile(files.latest!.memory.global)}>
                    {files.latest?.memory.global.content !== null
                      ? language.t("common.edit")
                      : language.t("settings.rules.file.create")}
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function ProjectSelect(props: {
  projects: ReadonlyArray<{ projectID: string; name: string }>
  projectID: string | undefined
  onSelect: (projectID: string | undefined) => void
}) {
  const language = useLanguage()
  const options = () => props.projects.map((item) => ({ id: item.projectID, label: item.name }))

  return (
    <Select
      options={options()}
      value={(item) => item.id}
      label={(item) => item.label}
      current={options().find((option) => option.id === props.projectID)}
      onSelect={(item) => props.onSelect(item?.id)}
      class="max-w-56"
      valueClass="truncate"
      aria-label={language.t("settings.workspaces.create.project")}
    />
  )
}

function SourceAddDialog(props: { onSaved?: () => void; onClose?: () => void }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [value, setValue] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  const save = async () => {
    if (saving() || !value().trim()) return
    setSaving(true)
    try {
      await sdk.api.experimental.config.update({ instruction: { source: value().trim() } })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.extensions.saved.title"),
        description: language.t("settings.extensions.saved.description", { name: value().trim() }),
      })
      props.onSaved?.()
      props.onClose?.()
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog size="large" variant="settings" preventBackdropDismiss={saving()}>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.rules.sources.add.title")}
          description={language.t("settings.rules.sources.add.description")}
        />
      </DialogHeader>
      <DialogBody class="custom-agent-dialog-body" style={{ padding: "8px 24px 16px" }}>
        <TextField
          label={language.t("settings.rules.sources.add.label")}
          value={value()}
          onChange={setValue}
          placeholder={language.t("settings.rules.sources.add.placeholder")}
          autofocus
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={() => void save()} disabled={saving() || !value().trim()}>
          <Show when={saving()} fallback={language.t("common.save")}>
            <Loader class="custom-agent-dialog-spinner" />
          </Show>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function FileEditDialog(props: { title: string; path: string; content: string; onSaved?: () => void; onClose?: () => void }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [content, setContent] = createSignal(props.content)
  const [saving, setSaving] = createSignal(false)

  const save = async () => {
    if (saving()) return
    setSaving(true)
    try {
      await sdk.api.experimental.file.write({
        path: props.path,
        payload: encoder.encode(content()),
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.extensions.saved.title"),
        description: language.t("settings.extensions.saved.description", { name: props.path }),
      })
      props.onSaved?.()
      props.onClose?.()
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog size="x-large" variant="settings" resizable maximizable preventBackdropDismiss={saving()}>
      <DialogHeader>
        <DialogTitleGroup title={props.title} description={props.path} />
      </DialogHeader>
      <DialogBody class="custom-agent-dialog-body" style={{ padding: "8px 24px 16px" }}>
        <textarea
          class="custom-agent-dialog-textarea rules-editor"
          value={content()}
          rows={18}
          onChange={(event) => setContent(event.currentTarget.value)}
          spellcheck={false}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={() => void save()} disabled={saving()}>
          <Show when={saving()} fallback={language.t("common.save")}>
            <Loader class="custom-agent-dialog-spinner" />
          </Show>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
