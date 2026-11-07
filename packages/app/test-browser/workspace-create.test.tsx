import { afterEach, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"

// Compile the real dialog with the same presets as Vite. Mirrors the other driver fixtures.
const require = createRequire(import.meta.url)
const solid = createRequire(require.resolve("vite-plugin-solid"))
const { transformSync } = solid("@babel/core")

Bun.plugin.clearAll()

Bun.plugin({
  name: "workspace-create-solid-context",
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

const state = {
  created: [] as Array<{ projectID: string; branch?: string; name?: string }>,
  synced: [] as string[],
  branches: ["main", "dev"],
}

const reset = () => {
  state.created.length = 0
  state.synced.length = 0
}

mock.module("@/runtime/i18n/language", () => ({
  useLanguage: () => ({ t: (key: string) => key, intl: () => "en-US" }),
}))

mock.module("@/runtime/server/client", () => ({
  useServerSDK: () => ({
    connection: { status: () => "connected" },
    api: {
      location: {
        get: async () => ({ project: { id: "p1", directory: "C:/code/alpha", canonical: "C:/code/alpha" } }),
      },
      worktree: {
        create: async (input: { projectID: string; branch?: string; name?: string }) => {
          state.created.push(input)
          return { directory: "C:/code/alpha.wt" }
        },
      },
      vcs: {
        branch: {
          list: async () => ({ data: state.branches }),
        },
      },
    },
  }),
}))

mock.module("@/runtime/server/current", () => ({
  useData: () => ({
    location: {
      syncInfo: async (ref?: { directory?: string }) => {
        if (ref?.directory) state.synced.push(ref.directory)
      },
    },
  }),
}))

const { DialogCreateWorkspace } = await import("@/settings/workspaces/create-dialog")

const projects = [
  { id: "p1", worktree: "C:/code/alpha", name: "Alpha", time: {} },
  { id: "p2", worktree: "C:/code/beta", time: {} },
]

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).reverse().forEach((dispose) => dispose())
  reset()
})

function mount(onCreated?: (projectID: string, directory: string) => void) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () =>
      createComponent(Kobalte, {
        open: true,
        get children() {
          return createComponent(DialogCreateWorkspace, {
            projects,
            data: { location: { syncInfo: async (ref?: { directory?: string }) => void (ref && state.synced.push(ref.directory)) } },
            get onCreated() {
              return onCreated
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

describe("DialogCreateWorkspace driver", () => {
  test("creates a worktree for the selected project with an optional name", async () => {
    let createdWith: [string, string] | undefined
    const host = mount((projectID, directory) => {
      createdWith = [projectID, directory]
    })
    await settle()

    const fields = inputs(host)
    setValue(fields[0], "feature-x")

    const create = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "settings.workspaces.create.button",
    )
    expect(create).toBeTruthy()
    create!.click()
    await settle()

    expect(state.created).toEqual([
      { projectID: "p1", from: "C:/code/alpha", branch: undefined, name: "feature-x" },
    ])
    expect(state.synced).toEqual(["C:/code/alpha.wt"])
    expect(createdWith).toEqual(["p1", "C:/code/alpha.wt"])
  })
})
