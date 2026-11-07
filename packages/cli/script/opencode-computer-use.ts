import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

export type ComputerUseAsset = {
  readonly source: string
  readonly version: string
  readonly sha256: string
}

type Target = {
  readonly platform: string
  readonly arch: string
}

const cli = createRequire(path.resolve(import.meta.dirname, "../package.json"))

// The open-computer-use npm package bundles a self-contained native MCP server per platform
// (MIT, https://github.com/iFurySt/open-computer-use). `open-computer-use mcp` serves JSON-RPC
// over stdio. The macOS runtime ships as an .app bundle whose standalone-binary layout is
// unverified, so darwin builds embed nothing and the agent reports desktop tools as unavailable.
function executablePath(target: Target, root: string): string | undefined {
  if (target.platform === "win32")
    return path.join(root, "dist", "windows", target.arch === "arm64" ? "arm64" : "amd64", "open-computer-use.exe")
  if (target.platform === "linux")
    return path.join(root, "dist", "linux", target.arch === "arm64" ? "arm64" : "amd64", "open-computer-use")
  return undefined
}

export async function resolveComputerUse(target: Target): Promise<ComputerUseAsset | undefined> {
  const local = process.env.OPENCODE_COMPUTER_USE_BIN
  if (local && (target.platform !== process.platform || target.arch !== process.arch))
    throw new Error("OPENCODE_COMPUTER_USE_BIN can only be embedded in a build for the current platform and architecture")
  if (local)
    return {
      source: path.resolve(local),
      version: "local",
      sha256: createHash("sha256")
        .update(await readFile(path.resolve(local)))
        .digest("hex"),
    }

  const root = path.dirname(cli.resolve("open-computer-use/package.json"))
  const source = executablePath(target, root)
  if (!source) return undefined
  const manifest: unknown = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  if (!manifest || typeof manifest !== "object" || !("version" in manifest) || typeof manifest.version !== "string")
    throw new Error("Invalid package metadata for open-computer-use")

  return {
    source,
    version: manifest.version,
    sha256: createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
  }
}
