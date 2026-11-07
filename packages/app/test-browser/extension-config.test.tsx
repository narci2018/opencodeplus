import { afterEach, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"

// Bun does not compile Solid JSX. Compile the real dialog with the same presets as Vite. This
// mirrors the custom-agent and custom-model fixtures.
const require = createRequire(import.meta.url)
const solid = createRequire(require.resolve("vite-plugin-solid"))
const { transformSync } = solid("@babel/core")

Bun.plugin.clearAll()

Bun.plugin({
  name: "extension-config-solid-context",
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

type ConfigPatch = { mcp?: { name: string; config?: unknown; remove?: true }; plugin?: { package: string; remove?: true }; skill?: { source: string; remove?: true } }

const state = {
  patches: [] as ConfigPatch[],
  refreshed: 0,
}

const reset = () => {
  state.patches.length = 0
  state.refreshed = 0
}

mock.module("@/runtime/i18n/language", () => ({
  useLanguage: () => ({ t: (key: string) => key, intl: () => "en-US" }),
}))

mock.module("@/runtime/server/client", () => ({
  useServerSDK: () => ({
    connection: { status: () => "connected" },
    api: {
      experimental: {
        config: {
          update: async (patch: ConfigPatch) => {
            state.patches.push(patch)
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
      mcp: {
        server: {
          invalidate: () => {
            state.refreshed += 1
          },
          sync: async () => {},
        },
      },
    },
  }),
}))

mock.module("@/shell/notifications/toast", () => ({
  showToast: () => {},
}))

const { McpServerDialog } = await import("@/settings/providers/extension-config")

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach((dispose) => dispose())
  reset()
})

function mountDialog(editing?: { name: string; config: { type: "local" | "remote"; command?: string[]; url?: string } }) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () =>
      createComponent(Kobalte, {
        open: true,
        get children() {
          return createComponent(McpServerDialog, {
            existing: { mcpServers: {}, plugins: [], skills: [] },
            get editing() {
              return editing
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
  field.value = value
  field.dispatchEvent(new Event("input", { bubbles: true }))
  field.dispatchEvent(new Event("change", { bubbles: true }))
  return field
}

const inputs = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLInputElement>('input[data-slot="input-input"]'))

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe("McpServerDialog driver", () => {
  test("saves a local server as a config mcp patch", async () => {
    const host = mountDialog()

    const fields = inputs(host)
    setValue(fields[0], "playwright")
    setValue(fields[1], "npx -y @playwright/mcp@latest")

    const save = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "common.confirm",
    )
    expect(save).toBeTruthy()
    save!.click()
    await settle()

    expect(state.patches).toEqual([
      { mcp: { name: "playwright", config: { type: "local", command: ["npx", "-y", "@playwright/mcp@latest"] } } },
    ])
    expect(state.refreshed).toBe(1)
  })

  test("saves a remote server with parsed headers", async () => {
    const host = mountDialog()

    const fields = inputs(host)
    setValue(fields[0], "remote-mcp")
    // Switch the type to remote: the type select is fields[1] handled through Kobalte; drive the
    // signal by selecting the option through the select's hidden input is fragile, so edit a
    // remote dialog directly instead.
    const remote = mountDialog({ name: "remote-mcp", config: { type: "remote", url: "https://old.example.com" } })
    const remoteFields = inputs(remote)
    setValue(remoteFields[0], "remote-mcp")
    setValue(remoteFields[1], "https://mcp.example.com")
    setValue(remoteFields[2], "Authorization: Bearer sk-test")

    const save = Array.from(remote.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "common.confirm",
    )
    save!.click()
    await settle()

    expect(state.patches).toEqual([
      {
        mcp: {
          name: "remote-mcp",
          config: { type: "remote", url: "https://mcp.example.com", headers: { Authorization: "Bearer sk-test" } },
        },
      },
    ])
  })

  test("removes an edited server with the remove patch", async () => {
    const host = mountDialog({ name: "playwright", config: { type: "local", command: ["npx"] } })

    const remove = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "common.delete",
    )
    expect(remove).toBeTruthy()
    remove!.click()
    await settle()

    expect(state.patches).toEqual([{ mcp: { name: "playwright", remove: true } }])
  })
})
