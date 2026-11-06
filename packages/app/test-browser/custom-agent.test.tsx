import { afterEach, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"

// Bun does not compile Solid JSX. Compile the real dialog component with the
// same presets as Vite, along with every TSX module it loads, instead of
// replacing the implementation. This mirrors the custom-model fixture.
const require = createRequire(import.meta.url)
const solid = createRequire(require.resolve("vite-plugin-solid"))
const { transformSync } = solid("@babel/core")

// This file runs with --isolate. Replace the shared hyperscript preload so Solid owns refs and mount effects.
Bun.plugin.clearAll()

Bun.plugin({
  name: "custom-agent-solid-context",
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

type AgentPatch = {
  id: string
  name?: string
  description?: string
  system?: string
  model?: string | { providerID: string; model: string; variant?: string }
  mode?: "primary" | "all" | "subagent"
  hidden?: boolean
  permissions?: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>
  remove?: true
}

type McpServer = { name: string; status: { status: string; error?: string } }

// Fixture state captured by the mocked SDK and data providers.
const state = {
  configCalls: [] as Array<{ agent?: AgentPatch }>,
  generateCalls: [] as string[],
  generateReply: "",
  entries: [] as Array<{ type: string; info?: { agents?: Record<string, unknown> } }>,
  mcps: [] as McpServer[],
  agentInvalidations: 0,
  agentSyncs: 0,
  toasts: [] as Array<{ variant: string; title: string }>,
  closed: 0,
  saved: 0,
}

const reset = () => {
  state.configCalls.length = 0
  state.generateCalls.length = 0
  state.generateReply = ""
  state.entries.length = 0
  state.mcps.length = 0
  state.agentInvalidations = 0
  state.agentSyncs = 0
  state.toasts.length = 0
  state.closed = 0
  state.saved = 0
}

mock.module("@/runtime/i18n/language", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}))

mock.module("@/runtime/server/client", () => ({
  useServerSDK: () => ({
    connection: { status: () => "connected" },
    api: {
      config: {
        get: async () => state.entries,
      },
      experimental: {
        config: {
          update: async (input: { agent?: AgentPatch }) => {
            state.configCalls.push(input)
          },
        },
        generate: {
          text: async (input: { prompt: string }) => {
            state.generateCalls.push(input.prompt)
            return { text: state.generateReply }
          },
        },
      },
    },
  }),
}))

mock.module("@/runtime/server/current", () => ({
  useData: () => ({
    location: {
      default: () => ({ directory: "/tmp/project" }),
      agent: {
        invalidate: () => {
          state.agentInvalidations += 1
        },
        sync: async () => {
          state.agentSyncs += 1
        },
      },
      mcp: {
        server: {
          sync: async () => {},
          list: () => state.mcps,
        },
      },
      provider: {
        sync: async () => {},
        list: () => undefined,
      },
      model: {
        sync: async () => {},
        list: () => [],
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

// The dialog only renders the MCP form when the user asks for it; stub the component so the test
// does not load its integration graph.
mock.module("@/providers/connect/mcp-dialog", () => ({
  DialogMcp: () => null,
}))

const { CustomAgentDialog } = await import("@/providers/custom-agent/dialog")

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach((dispose) => dispose())
  reset()
})

type EditingAgent = Parameters<typeof CustomAgentDialog>[0]["editing"]

function mountDialog(existing: EditingAgent[] = [], editing?: EditingAgent) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () =>
      createComponent(Kobalte, {
        open: true,
        get children() {
          return createComponent(CustomAgentDialog, {
            existing,
            get editing() {
              return editing
            },
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

const setValue = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  // Solid's controlled fields listen to the native `input` event; raw textareas compiled from
  // `onChange` listen for `change`. Fire both so either wiring updates its signal.
  field.value = value
  field.dispatchEvent(new Event("input", { bubbles: true }))
  field.dispatchEvent(new Event("change", { bubbles: true }))
  return field
}

const byId = (host: HTMLElement, id: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)

const saveButton = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "settings.agents.custom.save",
  )

const generateButton = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "settings.agents.custom.generate",
  )

const checkboxByText = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="checkbox-checkbox-input"]')).find((input) =>
    input.closest('[data-component="checkbox"]')?.textContent?.includes(text),
  )

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe("CustomAgentDialog driver", () => {
  test("saves a callable agent with deny rules for unchecked tool groups", async () => {
    const host = mountDialog()

    setValue(byId(host, "custom-agent-brief")!, "")
    const name = byId(host, "custom-agent-name-input") ?? Array.from(host.querySelectorAll('input[data-slot="input-input"]'))[0]
    setValue(name!, "Code Reviewer")
    setValue(byId(host, "custom-agent-when")!, "When the user asks for a code review.")

    const shell = checkboxByText(host, "settings.agents.custom.tools.builtin.shell")
    expect(shell).toBeTruthy()
    expect(shell!.checked).toBe(true)
    shell!.click()
    await settle()
    expect(shell!.checked).toBe(false)

    const save = saveButton(host)
    expect(save).toBeTruthy()
    save!.click()
    await settle()

    expect(state.configCalls).toHaveLength(1)
    expect(state.configCalls[0].agent).toEqual({
      id: "code-reviewer",
      description: "When the user asks for a code review.",
      mode: "all",
      permissions: [{ action: "shell", resource: "*", effect: "deny" }],
    })
    expect(state.agentInvalidations).toBe(1)
    expect(state.agentSyncs).toBe(1)
    expect(state.saved).toBe(1)
    expect(state.closed).toBe(1)
    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0].variant).toBe("success")
  })

  test("keeps save disabled while the when-to-call description is missing", async () => {
    const host = mountDialog()

    const name = Array.from(host.querySelectorAll('input[data-slot="input-input"]'))[0]
    setValue(name!, "Code Reviewer")

    expect(saveButton(host)!.disabled).toBe(true)

    setValue(byId(host, "custom-agent-when")!, "When the user asks for a code review.")
    expect(saveButton(host)!.disabled).toBe(false)
  })

  test("restores tool selection from stored permissions when editing", async () => {
    state.mcps = [{ name: "github", status: { status: "connected" } }]
    const editing: EditingAgent = {
      id: "reviewer",
      description: "Reviews changes when asked.",
      mode: "all",
      permissions: [
        { action: "shell", resource: "*", effect: "deny" },
        { action: "github_*", resource: "*", effect: "deny" },
      ],
    }
    const host = mountDialog([], editing)
    await settle()

    expect(checkboxByText(host, "settings.agents.custom.tools.builtin.shell")!.checked).toBe(false)
    expect(checkboxByText(host, "settings.agents.custom.tools.builtin.read")!.checked).toBe(true)
    expect(checkboxByText(host, "github")!.checked).toBe(false)

    // Re-enable shell and save: the shell deny disappears, the MCP deny stays.
    checkboxByText(host, "settings.agents.custom.tools.builtin.shell")!.click()
    await settle()

    saveButton(host)!.click()
    await settle()

    expect(state.configCalls).toHaveLength(1)
    expect(state.configCalls[0].agent).toMatchObject({
      id: "reviewer",
      mode: "all",
      permissions: [{ action: "github_*", resource: "*", effect: "deny" }],
    })
  })

  test("fills the form from the generate reply and saves the generated tools", async () => {
    state.generateReply = JSON.stringify({
      name: "Doc Writer",
      whenToCall: "当用户要求撰写文档时。",
      system: "You write documentation.",
      tools: ["read", "edit"],
      mcpServers: [],
    })
    const host = mountDialog()

    setValue(byId(host, "custom-agent-brief")!, "一个写文档的智能体")
    const generate = generateButton(host)
    expect(generate).toBeTruthy()
    generate!.click()
    await settle()

    expect(state.generateCalls).toHaveLength(1)
    expect(state.generateCalls[0]).toContain("一个写文档的智能体")

    saveButton(host)!.click()
    await settle()

    expect(state.configCalls).toHaveLength(1)
    expect(state.configCalls[0].agent).toMatchObject({
      id: "doc-writer",
      description: "当用户要求撰写文档时。",
      system: "You write documentation.",
      mode: "all",
      permissions: [
        { action: "shell", resource: "*", effect: "deny" },
        { action: "webfetch", resource: "*", effect: "deny" },
        { action: "websearch", resource: "*", effect: "deny" },
        { action: "subagent", resource: "*", effect: "deny" },
        { action: "todowrite", resource: "*", effect: "deny" },
        { action: "question", resource: "*", effect: "deny" },
      ],
    })
  })

  test("shows an error toast when the generate reply is not parseable", async () => {
    state.generateReply = "I could not produce JSON."
    const host = mountDialog()

    setValue(byId(host, "custom-agent-brief")!, "一个写文档的智能体")
    generateButton(host)!.click()
    await settle()

    expect(state.configCalls).toHaveLength(0)
    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0].variant).toBe("error")
    expect(state.toasts[0].title).toBe("settings.agents.custom.generate.failed.title")
  })
})
