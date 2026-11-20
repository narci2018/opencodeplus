import { Switch } from "@opencode/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"

/**
 * Provider-level enable/disable for the models settings page. Off hides every model the
 * provider carries from the session model picker, whatever each model's own state is.
 */
export function ProviderDisableSwitch(props: {
  providerID: string
  providerName: string
  disabled: boolean
  onChange: (disabled: boolean) => void
}) {
  const language = useLanguage()

  return (
    <Switch
      checked={!props.disabled}
      onChange={(checked) => props.onChange(checked !== true)}
      aria-label={language.t("settings.models.provider.toggle", { provider: props.providerName })}
      hideLabel
    >
      {props.providerName}
    </Switch>
  )
}
