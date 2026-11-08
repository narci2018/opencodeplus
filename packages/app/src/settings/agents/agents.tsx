import { CustomAgents } from "@/providers/custom-agent"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { normalizeAgentList } from "@/runtime/server/global-sync/utils"
import { createMemo, For } from "solid-js"
import "@/settings/settings.css"

const DEFAULT_BUILTIN_AGENTS = [
  {
    id: "build",
    name: "Build",
    description: "默认主智能体：根据配置的工作区权限执行工具、读写文件与代码生成。",
    mode: "primary",
  },
  {
    id: "plan",
    name: "Plan",
    description: "需求规划智能体：探索代码库、梳理实现路径、拆解技术方案并制定步骤。",
    mode: "primary",
  },
  {
    id: "trae",
    name: "TRAE",
    description:
      "Trae CN 主智能体：通过 Code Mode 驱动代码、浏览器与桌面自动化工具的编排专家，擅长多步骤全流程任务。",
    mode: "all",
  },
  {
    id: "trae-bao",
    name: "TRAE 宝",
    description:
      "Trae CN 开发者伙伴助理：跨会话与跨项目记忆、多任务拆解并行推进、敏捷开发协作者与专属助理。",
    mode: "all",
  },
]

export const SettingsAgents = () => {
  const language = useLanguage()
  const data = useData()
  const sdk = useWorkspaceLocation()

  const liveBuiltins = createMemo(() => {
    const list = normalizeAgentList(data.location.agent.list({ directory: sdk().directory }) ?? [])
    const visible = list.filter((item) => item.native && !item.hidden && item.mode !== "subagent")
    if (visible.length === 0) return DEFAULT_BUILTIN_AGENTS
    return visible.map((item) => ({
      id: item.name,
      name: item.displayName || item.name,
      description: item.description ?? "",
      mode: item.mode,
    }))
  })

  return (
    <div class="settings-tab-body">
      <div class="settings-tab-header">
        <h2 class="settings-tab-title">{language.t("settings.agents.title")}</h2>
        <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.agents.description")}</span>
      </div>

      <div class="settings-models-group" data-component="builtin-agents-section">
        <div class="settings-models-group-header">
          <span class="settings-models-group-title">
            {language.t("settings.agents.builtin.title") ?? "内置与原生智能体"}
          </span>
        </div>
        <div class="settings-models-group-items">
          <For each={liveBuiltins()}>
            {(agent) => (
              <div class="settings-models-row">
                <div class="settings-models-row-copy">
                  <div class="flex items-center gap-2">
                    <span class="settings-models-row-title font-medium">{agent.name}</span>
                    <span class="text-10-regular px-1.5 py-0.5 rounded bg-v2-surface-subtle text-v2-text-muted border border-v2-border-subtle">
                      内置
                    </span>
                    <span class="text-10-regular px-1.5 py-0.5 rounded bg-v2-surface-subtle text-v2-text-muted border border-v2-border-subtle">
                      {agent.id}
                    </span>
                  </div>
                  <span class="settings-models-row-description">{agent.description}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      <CustomAgents />
    </div>
  )
}
