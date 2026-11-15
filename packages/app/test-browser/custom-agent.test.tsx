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
  useDialog: () => ({ show: () => {}, push: () => {}, close: () => {} }),
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

// The rewritten dialog uses plain styled fields instead of the shared TextField component.
const nameInput = (host: HTMLElement) =>
  host.querySelector<HTMLInputElement>("input.custom-agent-input")

const textareas = (host: HTMLElement) =>
  host.querySelectorAll<HTMLTextAreaElement>("textarea.custom-agent-prompt-textarea")

const saveButton = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "创建" || button.textContent?.trim() === "保存",
  )

// The generate flow lives in the internal ✨ 智能生成 overlay.
const openGenerator = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.includes("智能生成"),
  )

const generatorSubmit = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.includes("开始智能生成"),
  )

const generatorApply = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.includes("应用并填入智能体"),
  )

const checkboxByText = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="checkbox-checkbox-input"]')).find((input) =>
    input.closest('[data-component="checkbox"]')?.textContent?.includes(text),
  )

// Builtin tool groups render an emoji label inside the checkbox and the translated description
// next to it, so look up the row by its description text and take that row's checkbox.
const groupCheckbox = (host: HTMLElement, group: string) => {
  const row = Array.from(host.querySelectorAll<HTMLElement>(".custom-agent-tool-item")).find((item) =>
    item.querySelector(".custom-agent-tool-item-desc")?.textContent?.includes(
      `settings.agents.custom.tools.builtin.${group}.description`,
    ),
  )
  return row?.querySelector<HTMLInputElement>('input[data-slot="checkbox-checkbox-input"]')
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe("CustomAgentDialog driver", () => {
  test("saves a callable agent with deny rules for unchecked tool groups", async () => {
    const host = mountDialog()

    setValue(nameInput(host)!, "Code Reviewer")
    setValue(textareas(host)[1]!, "When the user asks for a code review.")

    const shell = groupCheckbox(host, "shell")
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

  test("auto-fills the when-to-call description when omitted and stays saveable", async () => {
    const host = mountDialog()

    setValue(nameInput(host)!, "Code Reviewer")
    expect(saveButton(host)!.disabled).toBe(false)

    saveButton(host)!.click()
    await settle()

    expect(state.configCalls).toHaveLength(1)
    expect(state.configCalls[0].agent).toMatchObject({
      id: "code-reviewer",
      description: "Code Reviewer：在需要相关专长或任务时由其他智能体与用户调用。",
      mode: "all",
    })
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

    expect(groupCheckbox(host, "shell")!.checked).toBe(false)
    expect(groupCheckbox(host, "read")!.checked).toBe(true)
    expect(checkboxByText(host, "github")!.checked).toBe(false)

    // Re-enable shell and save: the shell deny disappears, the MCP deny stays.
    groupCheckbox(host, "shell")!.click()
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

    openGenerator(host)!.click()
    await settle()

    const brief = host.querySelector<HTMLTextAreaElement>("textarea.agent-generator-textarea")
    expect(brief).toBeTruthy()
    setValue(brief!, "一个写文档的智能体")

    generatorSubmit(host)!.click()
    await settle()

    expect(state.generateCalls).toHaveLength(1)
    expect(state.generateCalls[0]).toContain("一个写文档的智能体")

    generatorApply(host)!.click()
    await settle()

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

  test("falls back to local synthesis when the generate reply is not parseable", async () => {
    state.generateReply = "I could not produce JSON."
    const host = mountDialog()

    openGenerator(host)!.click()
    await settle()

    setValue(host.querySelector<HTMLTextAreaElement>("textarea.agent-generator-textarea")!, "一个写文档的智能体")
    generatorSubmit(host)!.click()
    await settle()

    expect(state.generateCalls).toHaveLength(1)
    // The synthesizer produced a preview instead of an error.
    expect(host.querySelector(".agent-generator-preview-box")).toBeTruthy()
    expect(state.toasts[0].variant).toBe("success")

    generatorApply(host)!.click()
    await settle()

    saveButton(host)!.click()
    await settle()

    expect(state.configCalls).toHaveLength(1)
    expect(state.configCalls[0].agent).toMatchObject({ id: "一个写文档的智能体", mode: "all" })
  })

  test("maximizes and restores the dialog", () => {
    const host = mountDialog()

    const container = host.querySelector<HTMLElement>('[data-slot="dialog-container"]')
    const maximize = host.querySelector<HTMLButtonElement>('[data-slot="dialog-maximize-button"]')
    expect(container).toBeTruthy()
    expect(maximize).toBeTruthy()

    maximize!.click()
    expect(container!.hasAttribute("data-maximized")).toBe(true)
    expect(container!.style.width).toBe("calc(100vw - 24px)")
    // The maximized height reserves the titlebar area via env(), which happy-dom's CSSOM rejects
    // and silently drops, so the inline height is not observable here; real browsers keep it.

    maximize!.click()
    expect(container!.hasAttribute("data-maximized")).toBe(false)
    // The dialog had no inline size before maximizing, so restoring clears back to the CSS default.
    expect(container!.style.width).toBe("")
    expect(container!.style.height).toBe("")
    expect(container!.style.marginTop).toBe("")
  })

  test("resizes the dialog from the corner handle", () => {
    const host = mountDialog()

    const container = host.querySelector<HTMLElement>('[data-slot="dialog-container"]')
    const handle = host.querySelector<HTMLElement>('[data-slot="dialog-resize-handle"]')
    expect(container).toBeTruthy()
    expect(handle).toBeTruthy()

    handle!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 100 }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 700, clientY: 600 }))
    document.dispatchEvent(new MouseEvent("mouseup"))

    // happy-dom has no layout, so the drag clamps against the minimums from a zero-size start.
    expect(container!.style.width).toBe("600px")
    expect(container!.style.height).toBe("500px")
    // The pinned margins keep the top-left corner fixed instead of re-centering.
    expect(container!.style.marginLeft).toBe("0px")
    expect(container!.style.marginTop).toBe("0px")

    // A drag with a delta below the minimum clamps instead of shrinking. happy-dom has no layout,
    // so the second drag again starts from a zero-size read and lands on the 480px floor.
    handle!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 0, clientY: 0 }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 40, clientY: 0 }))
    document.dispatchEvent(new MouseEvent("mouseup"))

    expect(container!.style.width).toBe("480px")
  })
})
