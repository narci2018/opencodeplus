import { Button } from "@opencode/ui/button"
import { Loader } from "@opencode/ui/loader"
import { Select } from "@opencode/ui/select"
import { TextField } from "@opencode/ui/text-field"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { showToast } from "@/shell/notifications/toast"
import { createMemo, createResource, createSignal, Show, type Component } from "solid-js"
import type { Data } from "@opencode/client/solid"
import { getFilename } from "@opencode/util/path"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import type { Project } from "@/runtime/server/types"
import { createWorktree } from "@/workspaces/create"

export const DialogCreateWorkspace: Component<{
  projects: Project[]
  data: Pick<Data, "location">
  onCreated?: (projectID: string, directory: string) => void
  onClose?: () => void
}> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()

  const [projectID, setProjectID] = createSignal<string | undefined>(props.projects[0]?.id)
  const [name, setName] = createSignal("")
  const [branch, setBranch] = createSignal<string>()
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const project = createMemo(() => props.projects.find((item) => item.id === projectID()))
  const projectOptions = createMemo(() =>
    props.projects.map((item) => ({ id: item.id, label: item.name || getFilename(item.worktree) })),
  )

  // The base branch picker reads the canonical checkout of the selected project.
  const [branches] = createResource(
    () => project()?.worktree,
    async (directory) => {
      if (!directory) return []
      return sdk.api.vcs.branch
        .list({ location: { directory } })
        .then((result) => result.data)
        .catch(() => [])
    },
    { initialValue: [] },
  )

  const branchOptions = createMemo(() => [
    { id: undefined, label: language.t("settings.workspaces.create.branch.default") },
    ...(branches.latest ?? []).map((item) => ({ id: item, label: item })),
  ])

  const create = async () => {
    const target = project()
    if (!target || creating()) return
    setCreating(true)
    setError(undefined)
    try {
      const directory = await createWorktree({
        api: sdk.api,
        data: props.data,
        directory: target.worktree,
        ...(branch() ? { branch: branch() } : {}),
        ...(name().trim() ? { name: name().trim() } : {}),
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.workspaces.create.success.title"),
        description: directory,
      })
      props.onCreated?.(target.id, directory)
      props.onClose?.()
    } catch (cause) {
      const message = formatServerError(cause, language.t)
      setError(message)
      showToast({ variant: "error", title: language.t("settings.workspaces.create.failed.title"), description: message })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog size="large" variant="settings" preventBackdropDismiss={creating()}>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.workspaces.create.title")}
          description={language.t("settings.workspaces.create.description")}
        />
      </DialogHeader>
      <DialogBody class="custom-agent-dialog-body" style={{ padding: "8px 24px 16px" }}>
        <div class="custom-agent-dialog-field">
          <label class="custom-agent-dialog-label" for="workspace-create-project">
            {language.t("settings.workspaces.create.project")}
          </label>
          <Select
            id="workspace-create-project"
            options={projectOptions()}
            value={(item) => item.id}
            label={(item) => item.label}
            current={projectOptions().find((item) => item.id === projectID())}
            onSelect={(item) => {
              setProjectID(item?.id)
              setBranch(undefined)
            }}
            valueClass="truncate"
          />
        </div>

        <div class="custom-agent-dialog-field">
          <TextField
            label={language.t("settings.workspaces.create.name")}
            value={name()}
            onChange={(value) => setName(value)}
            placeholder={language.t("settings.workspaces.create.name.placeholder")}
          />
        </div>

        <div class="custom-agent-dialog-field">
          <label class="custom-agent-dialog-label" for="workspace-create-branch">
            {language.t("settings.workspaces.create.branch")}
          </label>
          <Select
            id="workspace-create-branch"
            options={branchOptions()}
            value={(item) => item.id ?? ""}
            label={(item) => item.label}
            current={branchOptions().find((item) => item.id === branch())}
            onSelect={(item) => setBranch(item?.id)}
            valueClass="truncate"
          />
        </div>

        <Show when={error()}>
          <div class="custom-agent-dialog-error" role="alert">
            <span>{error()}</span>
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onClose?.()} disabled={creating()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={() => void create()} disabled={!project() || creating()}>
          <Show when={creating()} fallback={language.t("settings.workspaces.create.button")}>
            <Loader class="custom-agent-dialog-spinner" />
          </Show>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
