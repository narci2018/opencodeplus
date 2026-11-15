import { afterEach, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"

const require = createRequire(import.meta.url)
const solid = createRequire(require.resolve("vite-plugin-solid"))
const { transformSync } = solid("@babel/core")

Bun.plugin.clearAll()

Bun.plugin({
  name: "custom-model-solid-context",
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

type ProviderPatch = {
  id: string
  package?: string
  canonical?: string
  name?: string
  settings?: { baseURL: string; apiKey?: string }
  models?: Record<string, { name?: string }>
  remove?: true
}

type ConfigEntry = { type: string; info?: { providers?: Record<string, unknown> } }

const state = {
  configCalls: [] as Array<{ provider?: ProviderPatch }>,
  entries: [] as ConfigEntry[],
  providerInvalidations: 0,
  modelInvalidations: 0,
  providerSyncs: 0,
  modelSyncs: 0,
  toasts: [] as Array<{ variant: string; title: string }>,
  closed: 0,
  saved: 0,
  proxyCalls: [] as Array<{ url: string }>,
  proxyBody: JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "o3-mini" }] }),
  shown: [] as Array<() => unknown>,
}

const reset = () => {
  state.configCalls.length = 0
  state.entries.length = 0
  state.providerInvalidations = 0
  state.modelInvalidations = 0
  state.providerSyncs = 0
  state.modelSyncs = 0
  state.toasts.length = 0
  state.closed = 0
  state.saved = 0
  state.proxyCalls.length = 0
  state.shown.length = 0
  state.proxyBody = JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "o3-mini" }] })
}

mock.module("@/runtime/i18n/language", () => ({
  useLanguage: () => ({ t: (key: string) => key, intl: () => "en-US" }),
}))

mock.module("@opencode/ui/context/dialog", () => ({
  useDialog: () => ({
    show: (component: () => unknown) => {
      state.shown.push(component)
    },
    close: () => {},
  }),
  useDialogLayer: () => ({ container: document.body, setBackdropDismiss: () => {}, setExitDuration: () => {} }),
}))

mock.module("@/runtime/server/client", () => ({
  useServerSDK: () => ({
    api: {
      config: { get: async () => state.entries },
      experimental: {
        config: {
          update: async (input: { provider?: ProviderPatch }) => { state.configCalls.push(input) },
        },
        network: {
          proxy: async (input: { url: string }) => {
            state.proxyCalls.push({ url: input.url })
            return { status: 200, statusText: "OK", body: state.proxyBody }
          },
        },
      },
    },
  }),
}))

mock.module("@/runtime/server/current", () => ({
  useData: () => ({
    location: {
      provider: {
        invalidate: () => { state.providerInvalidations += 1 },
        sync: async () => { state.providerSyncs += 1 },
      },
      model: {
        invalidate: () => { state.modelInvalidations += 1 },
        sync: async () => { state.modelSyncs += 1 },
      },
    },
  }),
}))

mock.module("@/shell/notifications/toast", () => ({
  showToast: (options: { variant: string; title: string }) => { state.toasts.push(options) },
}))

const { CustomModelDialog } = await import("@/providers/custom-model/dialog")
const { CustomModels } = await import("@/providers/custom-model")

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach((dispose) => dispose())
  reset()
})

function mountDialog(
  existing: Parameters<typeof CustomModelDialog>[0]["existing"] = [],
  editing?: Parameters<typeof CustomModelDialog>[0]["editing"],
) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => createComponent(Kobalte, {
      open: true,
      get children() {
        return createComponent(CustomModelDialog, {
          existing,
          get editing() { return editing },
          onSaved: () => { state.saved += 1 },
          onClose: () => { state.closed += 1 },
        })
      },
    }),
    host,
  )
  cleanups.push(() => { dispose(); host.remove() })
  return host
}

function mountList() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => createComponent(CustomModels, {}), host)
  cleanups.push(() => { dispose(); host.remove() })
  return host
}

const setValue = (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
  return input
}

const saveButton = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "settings.models.custom.save",
  )

const findButton = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  )

const settle = async (times = 4) => {
  for (let round = 0; round < times; round++) await new Promise((resolve) => setTimeout(resolve, 25))
}

describe("CustomModelDialog driver", () => {
  test("saves an OpenAI-compatible provider with the expected patch", async () => {
    const host = mountDialog()
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="input-input"]'))
    expect(inputs).toHaveLength(4)
    setValue(inputs[0], "My LLM")
    setValue(inputs[1], "https://example.com/v1")
    setValue(inputs[2], "sk-test")
    setValue(inputs[3], "gpt-4o")
    const save = saveButton(host)
    expect(save).toBeTruthy()
    save!.click()
    await settle()

    expect(state.configCalls).toHaveLength(1)
    expect(state.configCalls[0].provider).toMatchObject({
      id: "my-llm", package: "@opencode/ai/providers/openai-compatible", canonical: "openai-compatible",
      name: "My LLM", settings: { baseURL: "https://example.com/v1", apiKey: "sk-test" },
      models: { "gpt-4o": { name: "gpt-4o" } },
    })
    expect(state.saved).toBe(1)
    expect(state.closed).toBe(1)
    expect(state.toasts[0].variant).toBe("success")
  })

  test("leaves the API key out of the patch when the protocol does not need one", async () => {
    const host = mountDialog()
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="input-input"]'))
    setValue(inputs[0], "My LLM")
    setValue(inputs[1], "https://example.com/v1")
    setValue(inputs[3], "gpt-4o")
    saveButton(host)!.click()
    await settle()
    expect(state.configCalls[0].provider?.settings?.apiKey).toBeUndefined()
  })

  test("disables save until required fields are present", () => {
    const host = mountDialog()
    expect(saveButton(host)!.disabled).toBe(true)
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="input-input"]'))
    setValue(inputs[0], "My LLM")
    setValue(inputs[1], "https://example.com/v1")
    setValue(inputs[2], "sk-test")
    setValue(inputs[3], "gpt-4o")
    expect(saveButton(host)!.disabled).toBe(false)
  })

  test("lists an existing custom provider and drives its delete", async () => {
    state.entries = [{ type: "document", info: { providers: { "my-llm": {
      package: "@opencode/ai/providers/openai-compatible", canonical: "openai-compatible",
      name: "My LLM", settings: { baseURL: "https://example.com/v1", apiKey: "sk-test" },
      models: { "gpt-4o": { name: "gpt-4o" } },
    } } } } ]
    const host = mountList()
    await settle()
    const section = host.querySelector('[data-component="custom-models-section"]')
    expect(section).toBeTruthy()
    expect(section!.textContent).toContain("My LLM")
    const manage = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "settings.models.custom.section.manage",
    )
    manage!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    manage!.click()
    await settle(2)
    const deleteItem = Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitem'], button")).find((el) =>
      el.textContent?.trim().includes("common.delete"))
    deleteItem!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    deleteItem!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    deleteItem!.click()
    await settle()
    expect(state.configCalls[0].provider).toEqual({ id: "my-llm", remove: true })
  })

  test("edit mode restores all saved models as comma-separated IDs", async () => {
    const editing = {
      id: "my-llm", name: "My LLM",
      settings: { baseURL: "https://example.com/v1" },
      models: { "model-a": { name: "model-a" }, "model-b": { name: "model-b" }, "model-c": { name: "model-c" } },
    }
    const host = mountDialog([], editing)
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="input-input"]'))
    // The Model ID field (4th input) should show all saved models comma-separated
    expect(inputs[3].value).toContain("model-a")
    expect(inputs[3].value).toContain("model-b")
    expect(inputs[3].value).toContain("model-c")
  })

  test("fetch models opens a picker dialog and populates the model ID on apply", async () => {
    const host = mountDialog()
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="input-input"]'))
    setValue(inputs[0], "My LLM")
    setValue(inputs[1], "https://api.example.com/v1")
    setValue(inputs[2], "sk-test")

    const fetchBtn = findButton(host, "settings.models.custom.fetch.button")
    expect(fetchBtn).toBeTruthy()
    fetchBtn!.click()
    await settle()

    expect(state.proxyCalls).toHaveLength(1)
    expect(state.proxyCalls[0].url).toContain("/models")
    expect(state.shown).toHaveLength(1)

    // Render the picker dialog inside a Kobalte root
    const pickerHost = document.createElement("div")
    document.body.appendChild(pickerHost)
    const disposePicker = render(
      () => createComponent(Kobalte, {
        open: true,
        get children() { return state.shown[0]!() },
      }),
      pickerHost,
    )
    cleanups.push(() => { disposePicker(); pickerHost.remove() })
    await settle()

    // The picker should show the model checkboxes
    const checkboxes = pickerHost.querySelectorAll<HTMLInputElement>(".custom-model-picker-item input[type='checkbox']")
    expect(checkboxes.length).toBe(3)

    // Check the first two models
    checkboxes[0].click()
    checkboxes[1].click()
    await settle()

    // Click apply
    const apply = Array.from(pickerHost.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "settings.models.custom.fetch.apply",
    )
    expect(apply).toBeTruthy()
    apply!.click()
    await settle()

    // Model ID field should have the selected models
    expect(inputs[3].value).toContain("gpt-4o")
    expect(inputs[3].value).toContain("gpt-4o-mini")
    expect(inputs[3].value).not.toContain("o3-mini")
  })

  test("shows an error message when the fetch fails", async () => {
    state.proxyBody = "unauthorized"
    const host = mountDialog()
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="input-input"]'))
    setValue(inputs[0], "My LLM")
    setValue(inputs[1], "https://api.example.com/v1")
    setValue(inputs[2], "sk-bad")

    // Simulate a 401 response
    state.proxyCalls.length = 0
    // The proxy returns 200 always in the mock, so let's use a non-JSON body to trigger a parse error
    state.proxyBody = "not json at all"
    // Actually the proxy mock always returns 200 so parse will throw
    const fetchBtn = findButton(host, "settings.models.custom.fetch.button")
    fetchBtn!.click()
    await settle()

    // The fetch error is shown as a hint
    const errorHint = host.querySelector(".custom-model-dialog-fetch-error")
    expect(errorHint).toBeTruthy()
  })
})
