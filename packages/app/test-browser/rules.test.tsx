import { afterEach, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"

// Compile the real settings page with the same presets as Vite. Mirrors the other driver fixtures.
const require = createRequire(import.meta.url)
const solid = createRequire(require.resolve("vite-plugin-solid"))
const { transformSync } = solid("@babel/core")

Bun.plugin.clearAll()

Bun.plugin({
  name: "rules-solid-context",
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

const files = {
  rules: { agents_md: true, claude_md: false },
  instructions: ["~/rules/a.md"],
  globalAgents: { path: "C:/Users/narci/.config/opencode/AGENTS.md", content: "# Rules\n" },
  projectAgents: { path: "C:/code/alpha/AGENTS.md", content: null },
  memory: {
    enabled: true,
    distill: true,
    global: { path: "C:/Users/narci/.config/opencode/memory/MEMORY.md", content: "# Memory\n" },
    project: { path: "C:/code/alpha/.opencode/memory/MEMORY.md", content: null },
    projects: [{ projectID: "p1", name: "Alpha", directory: "C:/code/alpha", path: "C:/code/alpha/.opencode/memory/MEMORY.md" }],
  },
}

const state = {
  patches: [] as Array<Record<string, unknown>>,
  writes: [] as Array<{ path: string; text: string }>,
  shown: [] as Array<() => unknown>,
}

const reset = () => {
  state.patches.length = 0
  state.writes.length = 0
  state.shown.length = 0
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
  useDialogLayer: () => ({ container: () => document.body, setBackdropDismiss: () => {}, setExitDuration: () => {} }),
}))

mock.module("@/runtime/server/client", () => ({
  useServerSDK: () => ({
    connection: { status: () => "connected" },
    api: {
      experimental: {
        rules: {
          files: async () => files,
        },
        config: {
          update: async (patch: Record<string, unknown>) => {
            state.patches.push(patch)
          },
        },
        file: {
          write: async (input: { path: string; payload: Uint8Array }) => {
            state.writes.push({ path: input.path, text: new TextDecoder().decode(input.payload) })
          },
        },
      },
    },
  }),
}))

const { SettingsRules } = await import("@/settings/rules/rules")

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach((dispose) => dispose())
  reset()
})

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => createComponent(SettingsRules, {}), host)
  cleanups.push(() => {
    dispose()
    host.remove()
  })
  return host
}

const settle = async (times = 6) => {
  for (let round = 0; round < times; round++) await new Promise((resolve) => setTimeout(resolve, 50))
}

const switches = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLInputElement>('[data-component="switch"] input, input[type="checkbox"]'))

describe("SettingsRules driver", () => {
  test("renders import toggles, rule cards and instruction sources", async () => {
    const host = mount()
    await settle()

    const text = host.textContent ?? ""
    expect(text).toContain("settings.rules.imports.agents.title")
    expect(text).toContain("settings.rules.imports.claude.title")
    expect(text).toContain("settings.rules.file.globalAgents")
    expect(text).toContain("~/rules/a.md")
  })

  test("writes the rules config patch when a toggle flips", async () => {
    const host = mount()
    await settle()

    const agentSwitch = switches(host)[0]
    expect(agentSwitch).toBeTruthy()
    agentSwitch!.click()
    await settle()

    expect(state.patches).toEqual([{ rules: { agents_md: false } }])
  })

  test("saves edited rule file content through the file write endpoint", async () => {
    const host = mount()
    await settle()

    // The global AGENTS.md exists: its edit button opens the textarea dialog.
    const edit = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.trim() === "common.edit",
    )
    expect(edit).toBeTruthy()
    edit!.click()
    expect(state.shown).toHaveLength(1)

    // Render the captured dialog the way the dialog host would: inside a Kobalte root.
    const dialogHost = document.createElement("div")
    document.body.appendChild(dialogHost)
    const dispose = render(
      () =>
        createComponent(Kobalte, {
          open: true,
          get children() {
            return state.shown[0]!()
          },
        }),
      dialogHost,
    )
    cleanups.push(() => {
      dispose()
      dialogHost.remove()
    })
    await settle()

    const textarea = Array.from(dialogHost.querySelectorAll("textarea"))[0] as HTMLTextAreaElement | undefined
    expect(textarea).toBeTruthy()
    textarea!.value = "# Rules\nBe concise."
    textarea!.dispatchEvent(new Event("input", { bubbles: true }))
    textarea!.dispatchEvent(new Event("change", { bubbles: true }))

    const save = Array.from(dialogHost.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "common.save",
    )
    expect(save).toBeTruthy()
    save!.click()
    await settle()

    expect(state.writes).toEqual([{ path: files.globalAgents.path, text: "# Rules\nBe concise." }])
  })
})
