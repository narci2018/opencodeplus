import { useWorkspaceLocation } from "@/workspaces/location"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { onCleanup } from "solid-js"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { useSessionLayout } from "./session-layout"
import { useDialog } from "@opencode/ui/context"

const GO_UPSELL_FREE_TIER_LAST_SEEN_AT = "go_upsell_last_seen_at"

const GO_UPSELL_FREE_TIER_DONT_SHOW = "go_upsell_dont_show"

const GO_UPSELL_WINDOW = 86_400_000 // 24 hrs

const MAX_RETRY_AFTER_MS = 7 * 86_400_000

const CHATGPT_USAGE_LIMIT_WINDOW = 86_400_000 // 24 hrs

export function formatLimitReset(locale: string, created: number, retryAfterMs: number | undefined) {
  if (
    retryAfterMs === undefined ||
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs < 0 ||
    retryAfterMs > MAX_RETRY_AFTER_MS ||
    !Number.isFinite(created)
  )
    return undefined

  const at = created + retryAfterMs

  if (Number.isNaN(new Date(at).getTime())) return undefined

  const now = Date.now()
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString() && at - now < GO_UPSELL_WINDOW

  return new Intl.DateTimeFormat(
    locale,
    sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(at)
}

export const GoUpsellState = Persistence.struct({
  [GO_UPSELL_FREE_TIER_LAST_SEEN_AT]: Schema.NullOr(Schema.Finite),
  [GO_UPSELL_FREE_TIER_DONT_SHOW]: Schema.NullOr(Schema.Finite),
})

/**
 * Limit dialogs for this session screen.
 *
 * Fork policy: OpenCode Zen's free allowance is enforced in opencode.ai's cloud, and this build never upsells it.
 * A `provider.free-limit` refusal therefore stays a plain timeline error — the composer still recalls the blocked
 * prompt so switching models and resending is one step — instead of opening the "subscribe to OpenCode Go" dialog.
 */
export function useUsageExceededDialogs() {
  const sdk = useWorkspaceLocation()
  const dialog = useDialog()
  const { params } = useSessionLayout()

  const [chatgptUsageLimit, setChatGPTUsageLimit] = persisted(
    Persist.global("chatgpt-usage-limit"),
    Persistence.struct({ lastSeenAt: Schema.NullOr(Schema.Finite) }),
    { lastSeenAt: null },
  )

  onCleanup(
    sdk().event.on("session.step.failed", (evt) => {
      if (evt.data.sessionID !== params.id || dialog.active) return
      const error = evt.data.error

      if (error.type === "provider.free-limit") return

      if (error.type !== "provider.chatgpt-limit") return

      if (chatgptUsageLimit.lastSeenAt && Date.now() - chatgptUsageLimit.lastSeenAt < CHATGPT_USAGE_LIMIT_WINDOW) return

      void import("@/providers/connect/chatgpt-usage-limit").then((usage) => {
        if (dialog.active) return
        setChatGPTUsageLimit("lastSeenAt", Date.now())
        dialog.show(() => <usage.DialogChatGPTUsageLimit />)
      })
    }),
  )
}
