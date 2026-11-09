import type { IconProps } from "@opencode/ui/icon"
import type { useLanguage } from "@/runtime/i18n/language"
import type { SettingsRootTab } from "./surface"

export const pageIcons = {
  general: "sliders",
  network: "globe",
  appearance: "appearance",
  notifications: "notifications",
  shortcuts: "keyboard",
  projects: "folder",
  workspaces: "outline-worktree",
  providers: "providers",
  models: "models",
  agents: "agents",
  templates: "cube",
  marketplace: "mcp",
  automation: "task",
  usage: "window-analytics",
  rules: "brain",
  extensions: "extensions",
  servers: "server",
  experimental: "flask",
  about: "info",
} as const satisfies Record<SettingsRootTab, IconProps["name"]>

export const pageLabels = {
  general: "settings.tab.preferences",
  network: "settings.tab.network",
  appearance: "settings.general.section.appearance",
  notifications: "settings.tab.notifications",
  shortcuts: "settings.shortcuts.title",
  projects: "settings.tab.projects",
  workspaces: "settings.tab.workspaces",
  providers: "settings.providers.title",
  models: "settings.models.title",
  agents: "settings.agents.title",
  templates: "settings.templates.title",
  marketplace: "settings.marketplace.title",
  automation: "settings.automation.title",
  usage: "settings.usage.title",
  rules: "settings.rules.title",
  extensions: "settings.tab.extensions",
  servers: "settings.section.server",
  experimental: "settings.tab.experimental",
  about: "settings.tab.about",
} as const satisfies Record<SettingsRootTab, Parameters<ReturnType<typeof useLanguage>["t"]>[0]>
