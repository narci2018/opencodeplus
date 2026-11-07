export * as ComputerBinding from "./computer-binding.js"

import { existsSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

export type Binding = {
  /** Absolute path of the native `open-computer-use mcp` server executable. */
  readonly path: string
  /** Neutral working directory for the spawned server: the exe is host-level, so it must not
   * pin down the location directory (on Windows a process cwd makes that directory undeletable). */
  readonly cwd: string
  readonly version: string
  readonly sha256?: string
}

// The CLI build replaces this module with the embedded open-computer-use binary (see
// packages/cli/script/build.ts). In a development workspace the binary resolves from the
// `open-computer-use` dev dependency; with neither present, desktop tools stay unregistered
// and the TRAE agent reports them as unavailable.
const require = createRequire(import.meta.url)

const workDirectory = () => {
  const cwd = path.join(os.tmpdir(), "opencode-computer-use")
  mkdirSync(cwd, { recursive: true })
  return cwd
}

function resolve(): Binding | undefined {
  try {
    const manifestPath = require.resolve("open-computer-use/package.json")
    const manifest = require(manifestPath) as { version?: string }
    const root = path.dirname(manifestPath)
    const executable =
      process.platform === "win32"
        ? path.join(root, "dist", "windows", process.arch === "arm64" ? "arm64" : "amd64", "open-computer-use.exe")
        : process.platform === "linux"
          ? path.join(root, "dist", "linux", process.arch === "arm64" ? "arm64" : "amd64", "open-computer-use")
          : undefined
    if (!executable || !existsSync(executable)) return undefined
    return { path: executable, cwd: workDirectory(), version: manifest.version ?? "unknown" }
  } catch {
    return undefined
  }
}

export default resolve()
