import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { TextField } from "@opencode/ui/text-field"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { createSignal, For, Show, onMount, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { useSettingsSurface } from "../surface"
import { showToast } from "@/shell/notifications/toast"
import { sessionHref } from "@/shell/routes/session"
import {
  loadAutomationTasks,
  saveAutomationTasks,
  loadAutomationHistory,
  addAutomationHistory,
  type AutomationTask,
  type AutomationRunRecord,
} from "./store"
import "./automation.css"

export function SettingsAutomation(props: { headerAction?: JSX.Element }) {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useServerSDK()
  const tabs = useTabs()
  const surface = useSettingsSurface()

  const [subtab, setSubtab] = createSignal<"tasks" | "history">("tasks")
  const [tasks, setTasks] = createSignal<AutomationTask[]>([])
  const [history, setHistory] = createSignal<AutomationRunRecord[]>([])
  const [runningMap, setRunningMap] = createSignal<Record<string, boolean>>({})

  onMount(() => {
    setTasks(loadAutomationTasks())
    setHistory(loadAutomationHistory())
  })

  const toggleTask = (task: AutomationTask) => {
    const next = tasks().map((t) => (t.id === task.id ? { ...t, enabled: !t.enabled } : t))
    setTasks(next)
    saveAutomationTasks(next)
    showToast({
      variant: "default",
      title: task.enabled ? "已暂停任务" : "已启用任务",
      description: `任务“${task.name}”已${task.enabled ? "暂停" : "开启"}。`,
    })
  }

  const deleteTask = (taskId: string) => {
    const next = tasks().filter((t) => t.id !== taskId)
    setTasks(next)
    saveAutomationTasks(next)
    showToast({
      variant: "default",
      title: "任务已删除",
    })
  }

  const runTaskNow = async (task: AutomationTask) => {
    setRunningMap((prev) => ({ ...prev, [task.id]: true }))
    const startTime = Date.now()
    try {
      showToast({
        variant: "default",
        icon: "task",
        title: "自动化任务启动",
        description: `正在通过智能体 ${task.agent.toUpperCase()} 执行“${task.name}”…`,
      })

      // Create session
      const session = await sdk.api.session.create({
        title: `[自动化] ${task.name}`,
      })

      // Send prompt
      await sdk.api.session.prompt({
        sessionID: session.id,
        text: task.prompt,
        agents: [{ name: task.agent }],
      })

      const durationMs = Date.now() - startTime

      // Add to history
      const record: AutomationRunRecord = {
        id: `run-${Date.now()}`,
        taskId: task.id,
        taskName: task.name,
        agent: task.agent,
        startTime,
        durationMs,
        status: "success",
        sessionId: session.id,
        summary: `成功执行并生成新会话`,
      }
      addAutomationHistory(record)
      setHistory(loadAutomationHistory())

      // Update task state
      const next = tasks().map((t) =>
        t.id === task.id ? { ...t, lastRunTime: Date.now(), lastRunStatus: "success" as const } : t,
      )
      setTasks(next)
      saveAutomationTasks(next)

      showToast({
        variant: "success",
        icon: "circle-check",
        title: "自动化执行完成",
        description: `任务“${task.name}”已执行完毕，耗时 ${(durationMs / 1000).toFixed(1)} 秒。`,
      })
    } catch (cause) {
      const durationMs = Date.now() - startTime
      const record: AutomationRunRecord = {
        id: `run-${Date.now()}`,
        taskId: task.id,
        taskName: task.name,
        agent: task.agent,
        startTime,
        durationMs,
        status: "error",
        summary: String(cause),
      }
      addAutomationHistory(record)
      setHistory(loadAutomationHistory())

      const next = tasks().map((t) =>
        t.id === task.id ? { ...t, lastRunTime: Date.now(), lastRunStatus: "error" as const } : t,
      )
      setTasks(next)
      saveAutomationTasks(next)

      showToast({
        variant: "error",
        title: "任务执行异常",
        description: String(cause),
      })
    } finally {
      setRunningMap((prev) => ({ ...prev, [task.id]: false }))
    }
  }

  const openCreateTask = () => {
    dialog.push(() => (
      <CreateAutomationDialog
        onSave={(newTask) => {
          dialog.close()
          const next = [newTask, ...tasks()]
          setTasks(next)
          saveAutomationTasks(next)
          showToast({
            variant: "success",
            icon: "circle-check",
            title: "自动化任务创建成功",
            description: `任务“${newTask.name}”已成功登记。`,
          })
        }}
        onClose={() => dialog.close()}
      />
    ))
  }

  return (
    <div class="automation-screen">
      <div class="automation-header">
        <div class="automation-header-main">
          <div class="automation-title">{language.t("settings.automation.title")}</div>
          <div class="automation-description">{language.t("settings.automation.description")}</div>
        </div>
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <Button variant="contrast" size="small" onClick={openCreateTask}>
            <Icon name="plus" size="small" />
            <span>新建自动化</span>
          </Button>
          <Show when={props.headerAction}>{props.headerAction}</Show>
        </div>
      </div>

      <div class="automation-subtabs">
        <button
          type="button"
          class="automation-subtab-btn"
          data-active={subtab() === "tasks"}
          onClick={() => setSubtab("tasks")}
        >
          定时任务 ({tasks().length})
        </button>
        <button
          type="button"
          class="automation-subtab-btn"
          data-active={subtab() === "history"}
          onClick={() => {
            setHistory(loadAutomationHistory())
            setSubtab("history")
          }}
        >
          运行历史 ({history().length})
        </button>
      </div>

      <Show when={subtab() === "tasks"}>
        <div class="automation-tasks-list">
          <For each={tasks()}>
            {(task) => {
              const isRunning = () => !!runningMap()[task.id]

              return (
                <div class="automation-task-card">
                  <div class="automation-task-main">
                    <div class="automation-task-header">
                      <span class="automation-task-name">{task.name}</span>
                      <span class="automation-task-schedule">⏰ {task.schedule}</span>
                      <span class="automation-task-agent">智能体: {task.agent.toUpperCase()}</span>
                      <Show when={task.lastRunStatus}>
                        <span class="automation-status-badge" data-status={task.lastRunStatus}>
                          {task.lastRunStatus === "success" ? "最近成功" : "最近异常"}
                        </span>
                      </Show>
                    </div>

                    <div class="automation-task-desc">{task.description}</div>

                    <Show when={task.lastRunTime}>
                      <div class="automation-task-lastrun">
                        <span>上次运行: {new Date(task.lastRunTime!).toLocaleString()}</span>
                      </div>
                    </Show>
                  </div>

                  <div class="automation-task-actions">
                    <Button
                      variant={task.enabled ? "neutral" : "ghost"}
                      size="small"
                      onClick={() => toggleTask(task)}
                    >
                      {task.enabled ? "启用中" : "已暂停"}
                    </Button>
                    <Button
                      variant="contrast"
                      size="small"
                      disabled={isRunning()}
                      onClick={() => runTaskNow(task)}
                    >
                      {isRunning() ? "执行中…" : "▶ 立即执行"}
                    </Button>
                    <Button variant="ghost" size="small" onClick={() => deleteTask(task.id)}>
                      <Icon name="trash" size="small" />
                    </Button>
                  </div>
                </div>
              )
            }}
          </For>
        </div>
      </Show>

      <Show when={subtab() === "history"}>
        <Show
          when={history().length > 0}
          fallback={
            <div style={{ padding: "40px 0", "text-align": "center", color: "var(--v2-text-text-muted)" }}>
              暂无自动化运行历史。
            </div>
          }
        >
          <table class="automation-history-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>任务名称</th>
                <th>执行智能体</th>
                <th>启动时间</th>
                <th>耗时</th>
                <th>结果 / 关联会话</th>
              </tr>
            </thead>
            <tbody>
              <For each={history()}>
                {(record) => (
                  <tr>
                    <td>
                      <span class="automation-status-badge" data-status={record.status}>
                        {record.status === "success" ? "成功" : "失败"}
                      </span>
                    </td>
                    <td style={{ "font-weight": "500" }}>{record.taskName}</td>
                    <td>
                      <span class="automation-task-agent">{record.agent.toUpperCase()}</span>
                    </td>
                    <td style={{ color: "var(--v2-text-text-muted)" }}>
                      {new Date(record.startTime).toLocaleString()}
                    </td>
                    <td>{(record.durationMs / 1000).toFixed(1)}s</td>
                    <td>
                      <Show when={record.sessionId}>
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => {
                            const serverKey = surface.server()?.key ?? ""
                            surface.close()
                            tabs.addSessionTab({ sessionId: record.sessionId!, server: serverKey })
                            window.location.href = sessionHref(serverKey, record.sessionId!)
                          }}
                        >
                          查看会话 →
                        </Button>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>
    </div>
  )
}

function CreateAutomationDialog(props: {
  onSave: (task: AutomationTask) => void
  onClose: () => void
}) {
  const [name, setName] = createSignal("")
  const [desc, setDesc] = createSignal("")
  const [schedule, setSchedule] = createSignal("每天 09:00")
  const [agent, setAgent] = createSignal<"trae" | "trae-bao" | "build">("trae")
  const [prompt, setPrompt] = createSignal("")

  const canSave = () => name().trim().length > 0 && prompt().trim().length > 0

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitleGroup title="新建自动化流水线" description="设定执行周期与提示词，让智能体在后台定时自动巡检并交付结果。" />
      </DialogHeader>
      <DialogBody>
        <div class="automation-dialog-body">
          <TextField
            label="自动化名称"
            placeholder="例如：每日技术架构与安全巡检"
            value={name()}
            onChange={setName}
          />
          <TextField
            label="任务简述（选填）"
            placeholder="说明该自动化的目的和作用"
            value={desc()}
            onChange={setDesc}
          />
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <span style={{ "font-size": "13px", "font-weight": "500", color: "var(--v2-text-text-base)" }}>
              执行周期
            </span>
            <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
              {["每 1 小时", "每天 09:00", "每天 18:00", "每周一 09:30", "每周五 17:30"].map((s) => (
                <button
                  type="button"
                  class="automation-subtab-btn"
                  style={{ border: "1px solid var(--v2-border-border)" }}
                  data-active={schedule() === s}
                  onClick={() => setSchedule(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", "align-items": "center", gap: "16px" }}>
            <span style={{ "font-size": "13px", "font-weight": "500", color: "var(--v2-text-text-base)" }}>
              执行智能体
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              {(["trae", "trae-bao", "build"] as const).map((a) => (
                <button
                  type="button"
                  class="automation-subtab-btn"
                  style={{ border: "1px solid var(--v2-border-border)" }}
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
              自动执行提示词
            </span>
            <textarea
              class="template-prompt-preview"
              rows={6}
              placeholder="请输入定时触发时发给智能体的指令内容…"
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
        <Button
          variant="contrast"
          disabled={!canSave()}
          onClick={() => {
            props.onSave({
              id: `auto-${Date.now()}`,
              name: name().trim(),
              description: desc().trim() || "定时自动化任务",
              schedule: schedule(),
              agent: agent(),
              prompt: prompt().trim(),
              enabled: true,
            })
          }}
        >
          保存并启用
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
