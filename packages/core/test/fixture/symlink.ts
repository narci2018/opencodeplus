export * as SymlinkCapability from "./symlink.js"

import { mkdirSync, rmSync, symlinkSync } from "node:fs"
import path from "node:path"

let cached: boolean | undefined

/**
 * Whether this process can create symbolic links. Windows requires administrator or
 * developer-mode privileges, so symlink-driven tests skip when the probe fails. The probe
 * mirrors the call shape the tests use (an untyped symbolic link).
 */
export const canSymlink = (): boolean => {
  if (cached !== undefined) return cached
  try {
    const dir = path.join(process.env.OPENCODE_SYMLINK_PROBE_DIR ?? "", `probe-${process.pid}`)
    mkdirSync(dir, { recursive: true })
    const link = `${dir}.link`
    try {
      symlinkSync(dir, link)
    } finally {
      rmSync(link, { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
    cached = true
  } catch {
    cached = false
  }
  return cached
}
