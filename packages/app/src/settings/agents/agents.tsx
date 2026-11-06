import { CustomAgents } from "@/providers/custom-agent"
import { useLanguage } from "@/runtime/i18n/language"
import "@/settings/settings.css"

export const SettingsAgents = () => {
  const language = useLanguage()

  return (
    <div class="settings-tab-body">
      <div class="settings-tab-header">
        <h2 class="settings-tab-title">{language.t("settings.agents.title")}</h2>
        <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.agents.description")}</span>
      </div>
      <CustomAgents />
    </div>
  )
}
