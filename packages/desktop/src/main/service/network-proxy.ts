export * as NetworkProxy from "./network-proxy"

import { execFile } from "node:child_process"
import http from "node:http"
import { promisify } from "node:util"
import { session } from "electron"
import { Effect } from "effect"
import { NETWORK_PROXY_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

const execute = promisify(execFile)

// Bun's `fetch` picks the proxy up from the environment on every request, so the variables have to be set
// wherever model requests leave the process: this one, and the background service's. Only HTTP(S) proxies
// work; a `socks5://` address fails with `UnsupportedProxyProtocol`, so the setting rejects it.
const VARIABLES = ["HTTPS_PROXY", "HTTP_PROXY"]

/** The stored proxy URL, or nothing when the app should connect directly. */
export function read() {
  const value = getStore().get(NETWORK_PROXY_KEY)

  // SAFETY: the store holds arbitrary JSON, so a hand-edited settings file can put any value here.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- see SAFETY above
  if (typeof value !== "string") return undefined

  const url = value.trim()

  return url.length ? url : undefined
}

export function write(url: string | undefined) {
  if (url === undefined) {
    getStore().delete(NETWORK_PROXY_KEY)

    return
  }

  getStore().set(NETWORK_PROXY_KEY, url)
}

/**
 * A proxy URL, or nothing to connect directly.
 *
 * Throws for an address the runtime cannot use: an unparseable URL, a scheme Bun rejects, or one that
 * carries a path, because the proxy variables take an origin only.
 */
export function parse(value: string | undefined) {
  const url = value?.trim()

  if (!url) return undefined

  const parsed = new URL(url)

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("The proxy must be an http:// or https:// address. SOCKS proxies are not supported.")

  if (parsed.hostname && (parsed.pathname !== "/" || parsed.search || parsed.hash))
    throw new Error("The proxy must be a server address without a path, such as http://127.0.0.1:7890.")

  return parsed.href
}

// Bun reads lowercase `no_proxy` alone whenever it is set, so both spellings get the same merged list.
function ensureLoopbackNoProxy() {
  const noProxy = [
    ...new Set(
      [process.env.NO_PROXY, process.env.no_proxy, "127.0.0.1,localhost,::1"].flatMap((value) =>
        (value ?? "").split(",").flatMap((entry) => entry.trim() || []),
      ),
    ),
  ].join(",")

  process.env.NO_PROXY = noProxy
  process.env.no_proxy = noProxy
}

/** Read the proxy variables the environment already carries, keeping loopback direct. */
export function prepareEnvironment() {
  ensureLoopbackNoProxy()
  // SAFETY: Electron 41.2 ships a Node with http.setGlobalProxyFromEnv, which the current @types/node lacks.
  const proxyAwareHttp = http as typeof http & { setGlobalProxyFromEnv(): void }
  proxyAwareHttp.setGlobalProxyFromEnv()
}

/** Point this process's Node and Bun requests at the proxy, or back at the environment when clearing it. */
export function applyEnvironment(url: string | undefined) {
  for (const key of [...VARIABLES, ...VARIABLES.map((name) => name.toLowerCase())]) {
    if (url === undefined) delete process.env[key]
    else process.env[key] = url
  }

  prepareEnvironment()
}

/** The renderer's requests, the login flows and the update checks leave through Chromium's own stack. */
export const applySession = (url: string | undefined) =>
  Effect.tryPromise(() =>
    session.defaultSession.setProxy(
      url === undefined ? { mode: "system" } : { proxyRules: url, proxyBypassRules: "<-loopback>" },
    ),
  ).pipe(Effect.mapError((error) => new Error("Failed to update the Chromium proxy settings", { cause: error })))

/**
 * Save the proxy in the background service's own configuration so the server starts with it whoever launches
 * it: the desktop, the TUI or a later build. `service set env` stops the running server, so the caller
 * reconnects afterwards to bring it back with the new environment.
 */
export const applyToService = Effect.fn("NetworkProxy.applyToService")(function* (
  command: readonly string[],
  url: string | undefined,
) {
  const [program, ...args] = command

  if (program === undefined) return yield* Effect.fail(new Error("No CLI command to update the service configuration"))

  for (const key of VARIABLES) {
    yield* Effect.tryPromise(() =>
      execute(program, [...args, "service", url === undefined ? "unset" : "set", "env", key, ...(url ? [url] : [])], {
        timeout: 30_000,
      }),
    ).pipe(
      Effect.mapError((error) => new Error(`Failed to update ${key} in the service configuration`, { cause: error })),
    )
  }
})
