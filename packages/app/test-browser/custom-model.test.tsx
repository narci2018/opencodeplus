import { afterEach, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"

// Bun does not compile Solid JSX. Compile the real dialog component with the
// same presets as Vite, along with every TSX module it loads, instead of
// replacing the implementation. This mirrors the proven model-selection fixture.
const require = createRequire(import.meta.url)
const solid = createRequire(require.resolve("vite-plugin-solid"))
const { transformSync } = solid("@babel/core")

// This file runs with --isolate. Replace the shared hyperscript preload so Solid owns refs and mount effects.
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

// Fixture state captured by the mocked SDK and data providers.
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
}

mock.module("@/runtime/i18n/language", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}))

mock.module("@/runtime/server/client", () => ({
  useServerSDK: () => ({
    api: {
      config: {
        get: async () => state.entries,
      },
      experimental: {
        config: {
          update: async (input: { provider?: ProviderPatch }) => {
            state.configCalls.push(input)
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
        invalidate: () => {
          state.providerInvalidations += 1
        },
        sync: async () => {
          state.providerSyncs += 1
        },
      },
      model: {
        invalidate: () => {
          state.modelInvalidations += 1
        },
        sync: async () => {
          state.modelSyncs += 1
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
  useDialog: () => ({ show: () => {}, close: () => {} }),
  useDialogLayer: () => ({ container: () => document.body, setBackdropDismiss: () => {}, setExitDuration: () => {} }),
}))

const { CustomModelDialog } = await import("@/providers/custom-model/dialog")
const { CustomModels } = await import("@/providers/custom-model")

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach((dispose) => dispose())
  reset()
})

function mountDialog(existing: Parameters<typeof CustomModelDialog>[0]["existing"] = []) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () =>
      createComponent(Kobalte, {
        open: true,
        get children() {
          return createComponent(CustomModelDialog, {
            existing,
            onSaved: () => {
              state.saved += 1
            },
            onClose: () => {
              state.closed += 1
            },
          })
        },
      }),
    host,
  )
  cleanups.push(() => {
    dispose()
    host.remove()
  })
  return host
}

function mountList() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => createComponent(CustomModels, {}), host)
  cleanups.push(() => {
    dispose()
    host.remove()
  })
  return host
}

const setValue = (input: HTMLInputElement, value: string) => {
  // Solid's controlled inputs listen to the native `input` event.
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
  return input
}

const saveButton = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "settings.models.custom.save",
  )

describe("CustomModelDialog driver", () => {
  test("saves an OpenAI-compatible provider with the expected patch", async () => {
    const host = mountDialog()

    // Name, baseURL, apiKey, modelID in DOM order.
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="input-input"]'))
    expect(inputs).toHaveLength(4)

    setValue(inputs[0], "My LLM")
    setValue(inputs[1], "https://example.com/v1")
    setValue(inputs[2], "sk-test")
    setValue(inputs[3], "gpt-4o")

    const save = saveButton(host)
    expect(save).toBeTruthy()
    save!.click()

    // Let the async save settle.
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(state.configCalls).toHaveLength(1)
    expect(state.configCalls[0].provider).toMatchObject({
      id: "my-llm",
      package: "@opencode/ai/providers/openai-compatible",
      canonical: "openai-compatible",
      name: "My LLM",
      settings: { baseURL: "https://example.com/v1", apiKey: "sk-test" },
      models: { "gpt-4o": { name: "gpt-4o" } },
    })
    expect(state.providerInvalidations).toBe(1)
    expect(state.modelInvalidations).toBe(1)
    expect(state.providerSyncs).toBe(1)
    expect(state.modelSyncs).toBe(1)
    expect(state.saved).toBe(1)
    expect(state.closed).toBe(1)
    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0].variant).toBe("success")
  })

  test("leaves the API key out of the patch when the protocol does not need one", async () => {
    const host = mountDialog()

    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="input-input"]'))
    setValue(inputs[0], "My LLM")
    setValue(inputs[1], "https://example.com/v1")
    setValue(inputs[3], "gpt-4o")

    const save = saveButton(host)
    save!.click()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(state.configCalls).toHaveLength(1)
    // apiKey must be absent because the patch builder only sets it when non-empty.
    expect(state.configCalls[0].provider?.settings?.apiKey).toBeUndefined()
  })

  test("disables save until required fields are present", () => {
    const host = mountDialog()
    const save = saveButton(host)
    expect(save).toBeTruthy()
    expect(save!.disabled).toBe(true)

    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="input-input"]'))
    setValue(inputs[0], "My LLM")
    setValue(inputs[1], "https://example.com/v1")
    setValue(inputs[2], "sk-test")
    setValue(inputs[3], "gpt-4o")

    expect(save!.disabled).toBe(false)
  })

  test("lists an existing custom provider and drives its delete", async () => {
    state.entries = [
      {
        type: "document",
        info: {
          providers: {
            "my-llm": {
              package: "@opencode/ai/providers/openai-compatible",
              canonical: "openai-compatible",
              name: "My LLM",
              settings: { baseURL: "https://example.com/v1", apiKey: "sk-test" },
              models: { "gpt-4o": { name: "gpt-4o" } },
            },
          },
        },
      },
    ]
    const host = mountList()
    // The list loads on mount via sdk.api.config.get().
    await new Promise((resolve) => setTimeout(resolve, 10))

    const section = host.querySelector('[data-component="custom-models-section"]')
    expect(section).toBeTruthy()
    expect(section!.textContent).toContain("My LLM")

    // Open the manage menu and pick delete.
    const manage = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "settings.models.custom.section.manage",
    )
    expect(manage).toBeTruthy()
    manage!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    manage!.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const deleteItem = Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitem'], button")).find((el) =>
      el.textContent?.trim().includes("common.delete"),
    )
    expect(deleteItem).toBeTruthy()
    deleteItem!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    deleteItem!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    deleteItem!.click()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(state.configCalls).toHaveLength(1)
    expect(state.configCalls[0].provider).toEqual({ id: "my-llm", remove: true })
  })
})
