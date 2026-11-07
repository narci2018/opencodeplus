import { afterEach, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"

// Bun does not compile Solid JSX. Compile the real settings page with the same presets as Vite,
// along with every TSX module it loads, instead of replacing the implementation. This mirrors the
// custom-agent fixture.
const require = createRequire(import.meta.url)
const solid = createRequire(require.resolve("vite-plugin-solid"))
const { transformSync } = solid("@babel/core")

// This file runs with --isolate. Replace the shared hyperscript preload so Solid owns refs and mount effects.
Bun.plugin.clearAll()

Bun.plugin({
  name: "usage-solid-context",
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

const tokens = (input: number, output = 0, reasoning = 0, read = 0, write = 0) => ({
  input,
  output,
  reasoning,
  cache: { read, write },
})

const stats = {
  range: { from: 0, to: Date.now() },
  sessions: 3,
  subagents: 1,
  prompts: 5,
  steps: 12,
  tokens: tokens(1000, 500, 100, 2000, 300),
  cost: 1.234,
  tools: { mode: "none", totals: { calls: 0 } },
  activeDays: 4,
  streak: 2,
  activity: [
    { date: "2026-11-05", steps: 4 },
    { date: "2026-11-06", steps: 8 },
  ],
  models: [{ model: { providerID: "anthropic", id: "claude-sonnet-4" }, steps: 12, tokens: tokens(1000, 500), cost: 1.2 }],
}

const sessions = [
  {
    id: "s1",
    projectID: "p1",
    title: "Alpha build",
    cost: 1.0,
    tokens: tokens(800, 400),
    model: { providerID: "anthropic", id: "claude-sonnet-4" },
    time: { created: Date.now() - 5000, updated: Date.now() - 1000 },
  },
  {
    id: "s2",
    projectID: "p1",
    title: "Alpha review",
    cost: 0.5,
    tokens: tokens(200, 100),
    time: { created: Date.now() - 9000, updated: Date.now() - 2000 },
  },
  {
    id: "s3",
    projectID: "p2",
    title: "Beta fix",
    cost: 0.2,
    tokens: tokens(50, 20),
    time: { created: Date.now() - 12000, updated: Date.now() - 3000 },
  },
]

const projects = [
  { id: "p1", canonical: "C:/code/alpha", name: "Alpha", time: {} },
  { id: "p2", canonical: "C:/code/beta", time: {} },
]

const messages = [
  { type: "user", id: "m0", time: { created: 1 }, content: "hi" },
  {
    type: "assistant",
    id: "m1",
    agent: "build",
    model: { providerID: "anthropic", id: "claude-sonnet-4" },
    time: { created: 2, completed: 3 },
    content: [],
    cost: 0.7,
    tokens: tokens(500, 300, 40),
  },
  {
    type: "compaction",
    id: "m2",
    status: "completed",
    reason: "auto",
    summary: "summarized",
    time: { created: 4 },
    cost: 0.1,
    tokens: tokens(300, 50),
  },
  { type: "user", id: "m3", time: { created: 5 }, content: "go on" },
]

// Fixture state captured by the mocked SDK and dialog context.
const state = {
  shown: [] as Array<() => unknown>,
}

const reset = () => {
  state.shown.length = 0
}

mock.module("@/runtime/i18n/language", () => ({
  useLanguage: () => ({ t: (key: string) => key, intl: () => "en-US" }),
}))

mock.module("@/runtime/server/client", () => ({
  useServerSDK: () => ({
    connection: { status: () => "connected" },
    scope: "test",
    api: {
      experimental: {
        session: {
          stats: async () => stats,
        },
      },
      session: {
        list: async (input?: { limit?: number; cursor?: string }) => {
          const start = input?.cursor ? Number(input.cursor) : 0
          const page = sessions.slice(start, start + (input?.limit ?? 50))
          const next = start + page.length < sessions.length ? String(start + page.length) : undefined
          return { data: page, cursor: { next } }
        },
      },
      message: {
        list: async (input: { sessionID: string }) => {
          if (input.sessionID !== "s1") return { data: [], cursor: {} }
          return { data: messages, cursor: {} }
        },
      },
      project: {
        list: async () => projects,
      },
    },
  }),
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

const { SettingsUsage } = await import("@/settings/usage/usage")

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach((dispose) => dispose())
  reset()
})

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => createComponent(SettingsUsage, {}), host)
  cleanups.push(() => {
    dispose()
    host.remove()
  })
  return host
}

const settle = async (times = 6) => {
  for (let round = 0; round < times; round++) await new Promise((resolve) => setTimeout(resolve, 50))
}

const text = (host: HTMLElement) => host.textContent ?? ""

describe("SettingsUsage driver", () => {
  test("renders the overview cards, project groups and session rows", async () => {
    const host = mount()
    await settle()

    // Overview cards come from the stats endpoint.
    expect(text(host)).toContain("settings.usage.card.cost")
    expect(text(host)).toContain("$1.23")

    // Projects are grouped by name with summed costs: Alpha = 1.0 + 0.5.
    expect(text(host)).toContain("Alpha")
    expect(text(host)).toContain("$1.50")
    expect(text(host)).toContain("Beta")
    expect(text(host)).toContain("$0.20")

    // Session rows show titles and compact token totals in the sub-group under projects.
    expect(text(host)).toContain("Alpha build")
    expect(text(host)).toContain("1.2k")
    expect(text(host)).toContain("claude-sonnet-4")

    // Switch to the models tab.
    const modelsTab = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("settings.usage.section.models"),
    )
    expect(modelsTab).toBeTruthy()
    modelsTab!.click()
    await settle()

    // The by-model table carries the full token breakdown and the per-step efficiency metric.
    expect(text(host)).toContain("settings.usage.tokens.perStep")
    expect(text(host)).toContain("125")
  })

  test("opens a session dialog with per-message usage rows and model totals", async () => {
    const host = mount()
    await settle()

    const row = Array.from(host.querySelectorAll<HTMLButtonElement>(".usage-table-row--click")).find((button) =>
      button.textContent?.includes("Alpha build"),
    )
    expect(row).toBeTruthy()
    row!.click()
    expect(state.shown).toHaveLength(1)

    // Render the captured dialog content the way the dialog host would: inside a Kobalte root.
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

    expect(text(dialogHost)).toContain("Alpha build")
    // The assistant row and the completed compaction row are listed with their usage.
    expect(text(dialogHost)).toContain("settings.usage.kind.assistant")
    expect(text(dialogHost)).toContain("settings.usage.kind.compaction")
    expect(text(dialogHost)).toContain("$0.70")
    expect(text(dialogHost)).toContain("$0.10")
    // The user message (no usage) stays out of the table.
    expect(text(dialogHost)).not.toContain("m3")
  })

  test("toggles column sorting on header click", async () => {
    const host = mount()
    await settle()

    // Initially sorted by cost desc: Alpha ($1.50) then Beta ($0.20)
    const costHeader = Array.from(host.querySelectorAll<HTMLButtonElement>(".usage-th-sort")).find((btn) =>
      btn.textContent?.includes("settings.usage.card.cost"),
    )
    expect(costHeader).toBeTruthy()

    // Click cost header to toggle to asc
    costHeader!.click()
    await settle()

    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>(".usage-table-row--click"))
    // In asc order, beta project ($0.20) should be first
    expect(rows[0]?.textContent).toContain("beta")
  })
})
