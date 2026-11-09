import { Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsList } from "@/settings/list"
import { NetworkProxySetting } from "../general/network-proxy"
import "@/settings/settings.css"

export const SettingsNetwork: Component = () => {
  const language = useLanguage()

  return (
    <div class="settings-list-screen" data-action="settings-network">
      <div class="settings-heading">
        <h1 class="settings-heading-title">{language.t("settings.network.title")}</h1>
        <p class="settings-heading-description">{language.t("settings.network.description")}</p>
      </div>
      <SettingsList>
        <NetworkProxySetting />
      </SettingsList>
    </div>
  )
}
