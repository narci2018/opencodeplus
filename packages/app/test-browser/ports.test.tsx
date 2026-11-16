import { afterEach, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"

// Compile the real settings page with the same presets as Vite. Mirrors the other driver fixtures.
const require = createRequire(import.meta.url)
const solid = createRequire(require.resolve("vite-plugin-solid"))
const { transformSync } = solid("@babel/core")

Bun.plugin.clearAll()

Bun.plugin({
  name: "ports-solid-context",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => ({
      contents: transformSync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [solid.resolve("babel-preset-solid"), solid.resolve("@babel/preset-typescript")],
      }).code,
      loader: "js",
    }))
  },
})

type PortRow = {
  id: "callback_openai" | "callback_openai_fallback" | "callback_digitalocean" | "callback_gitlab"
  default_port: number
  configured_port: number | null
  available: boolean
  configurable: boolean
}

const rows: PortRow[] = [
  { id: "callback_openai", default_port: 1455, configured_port: 1455, available: false, configurable: true },
  { id: "callback_openai_fallback", default_port: 1457, configured_port: null, available: true, configurable: true },
  { id: "callback_digitalocean", default_port: 1456, configured_port: null, available: true, configurable: true },
  { id: "callback_gitlab", default_port: 8080, configured_port: null, available: true, configurable: false },
]

const state = {
  patches: [] as Array<Record<string, unknown>>,
  probes: 0,
  toasts: [] as Array<{ variant: string; title: string }>,
}

const reset = () => {
  state.patches.length = 0
  state.probes = 0
  state.toasts.length = 0
}

mock.module("@/runtime/i18n/language", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}))

mock.module("@/runtime/server/client", () => ({
  useServerSDK: () => ({
    connection: { status: () => "connected" },
    api: {
      experimental: {
        ports: {
          status: async () => {
            state.probes += 1
            return { ports: rows }
          },
        },
        config: {
          update: async (patch: Record<string, unknown>) => {
            state.patches.push(patch)
          },
        },
      },
    },
  }),
}))

mock.module("@/shell/notifications/toast", () => ({
  showToast: (options: { variant: string; title: string }) => {
    state.toasts.push(options)
  },
}))

mock.module("@opencode/ui/context/dialog", () => ({
  useDialog: () => ({ show: () => {}, push: () => {}, close: () => {} }),
  useDialogLayer: () => ({ container: () => document.body, setBackdropDismiss: () => {}, setExitDuration: () => {} }),
}))

const { SettingsPorts } = await import("@/settings/ports/ports")

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach((dispose) => dispose())
  reset()
})

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => createComponent(SettingsPorts, {}), host)
  cleanups.push(() => {
    dispose()
    host.remove()
  })
  return host
}

const settle = async (times = 6) => {
  for (let round = 0; round < times; round++) await new Promise((resolve) => setTimeout(resolve, 50))
}

// Each row's editable field is the TextField; the OpenAI row is the first configurable one in DOM order.
const fieldFor = (host: HTMLElement, index: number) =>
  Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="input-input"]'))[index]

const saveButtonFor = (host: HTMLElement, index: number) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).filter(
    (button) => button.textContent?.trim() === "common.save",
  )[index]

describe("SettingsPorts driver", () => {
  test("renders one row per known port with availability badges", async () => {
    const host = mount()
    await settle()

    const text = host.textContent ?? ""
    expect(text).toContain("settings.ports.row.callback_openai.title")
    expect(text).toContain("settings.ports.row.callback_digitalocean.title")
    expect(text).toContain("settings.ports.row.callback_gitlab.title")

    // The occupied OpenAI port shows the occupied badge; the default OpenAI port is still echoed.
    const occupied = Array.from(host.querySelectorAll("span")).filter(
      (span) => span.textContent?.trim() === "settings.ports.occupied",
    )
    expect(occupied).toHaveLength(1)
    expect(text).toContain("1455")

    // GitLab renders no editable field, only the fixed notice.
    expect(text).toContain("settings.ports.fixed")
    expect(Array.from(host.querySelectorAll('input[data-slot="input-input"]'))).toHaveLength(3)
  })

  test("saves a custom port as a config patch and clears the draft", async () => {
    const host = mount()
    await settle()

    const field = fieldFor(host, 0)
    expect(field).toBeTruthy()
    field!.value = "18080"
    field!.dispatchEvent(new Event("input", { bubbles: true }))

    // Saving needs an edited draft: the button only enables once the field changes.
    const save = saveButtonFor(host, 0)
    expect(save).toBeTruthy()
    expect(save!.disabled).toBe(false)
    save!.click()
    await settle()

    expect(state.patches).toEqual([{ ports: { callback_openai: 18080 } }])
    expect(state.toasts[0].variant).toBe("success")
    // The patch re-probes the server, so the status refreshes.
    expect(state.probes).toBeGreaterThan(1)
  })

  test("an empty draft restores the default with a null patch", async () => {
    const host = mount()
    await settle()

    const field = fieldFor(host, 0)
    field!.value = ""
    field!.dispatchEvent(new Event("input", { bubbles: true }))

    saveButtonFor(host, 0)!.click()
    await settle()

    expect(state.patches).toEqual([{ ports: { callback_openai: null } }])
  })

  test("an out-of-range port shows an error toast without a patch", async () => {
    const host = mount()
    await settle()

    const field = fieldFor(host, 0)
    field!.value = "99"
    field!.dispatchEvent(new Event("input", { bubbles: true }))

    saveButtonFor(host, 0)!.click()
    await settle()

    expect(state.patches).toEqual([])
    expect(state.toasts[0].variant).toBe("error")
  })
})
