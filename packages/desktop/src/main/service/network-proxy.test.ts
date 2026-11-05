import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"

import { applyEnvironment, applyToService, parse } from "./network-proxy"

const roots: string[] = []

afterEach(() => {
  for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "NO_PROXY", "no_proxy"])
    delete process.env[key]

  return Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("network proxy address", () => {
  test("parse accepts an http(s) server address and drops the trailing slash", () => {
    expect(parse("http://127.0.0.1:10808")).toBe("http://127.0.0.1:10808")
    expect(parse("http://127.0.0.1:10808/")).toBe("http://127.0.0.1:10808")
    expect(parse("  https://proxy.example:8080  ")).toBe("https://proxy.example:8080")
    expect(parse("http://user:secret@proxy.example:8080")).toBe("http://user:secret@proxy.example:8080")
  })

  test("parse clears on blank and rejects what the runtime cannot use", () => {
    expect(parse(undefined)).toBeUndefined()
    expect(parse("   ")).toBeUndefined()
    expect(() => parse("socks5://127.0.0.1:7891")).toThrow("SOCKS proxies are not supported")
    expect(() => parse("http://127.0.0.1:10808/pac")).toThrow("without a path")
    expect(() => parse("http://127.0.0.1:10808/?a=1")).toThrow("without a path")
  })
})

describe("network proxy environment", () => {
  test("applyEnvironment points the proxy variables at the address and keeps loopback direct", () => {
    applyEnvironment("http://127.0.0.1:10808")

    expect(process.env.HTTPS_PROXY).toBe("http://127.0.0.1:10808")
    expect(process.env.http_proxy).toBe("http://127.0.0.1:10808")
    expect(process.env.NO_PROXY?.split(",")).toContain("127.0.0.1")
    expect(process.env.no_proxy).toBe(process.env.NO_PROXY)
  })

  test("applyEnvironment keeps an existing exclusion list and clears the proxy variables", () => {
    process.env.NO_PROXY = "intranet.example"
    applyEnvironment("http://127.0.0.1:10808")

    expect(process.env.NO_PROXY?.split(",")).toEqual(["intranet.example", "127.0.0.1", "localhost", "::1"])

    applyEnvironment(undefined)

    expect(process.env.HTTPS_PROXY).toBeUndefined()
    expect(process.env.NO_PROXY).toContain("intranet.example")
  })
})

describe("network proxy service configuration", () => {
  // The recorder is the CLI's stand-in: it writes the argv of every `service set|unset env` call to a file,
  // so the test asserts the command line the service would actually be given.
  const recorded = async () => {
    const root = await mkdtemp(path.join(tmpdir(), "network-proxy-"))
    const calls = path.join(root, "calls.jsonl")
    const script = path.join(root, "record.ts")

    await writeFile(
      script,
      `import { appendFileSync } from "node:fs"\nappendFileSync(process.env.RECORDED_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n")\n`,
    )
    process.env.RECORDED_CALLS = calls
    roots.push(root)

    return {
      command: [process.execPath, script] as const,
      // SAFETY: the recorder writes the child's argv as one JSON array per line, so each line is a string array.
      read: async () =>
        (await readFile(calls, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[]),
    }
  }

  test("applying a proxy stores both proxy variables and the loopback exclusions", async () => {
    const { command, read } = await recorded()

    // The assertion is on the exact command line, so the launcher's own exclusion list must not leak in.
    delete process.env.NO_PROXY
    delete process.env.no_proxy
    await Effect.runPromise(applyToService(command, "http://127.0.0.1:10808"))

    expect(await read()).toEqual([
      ["service", "set", "env", "HTTPS_PROXY", "http://127.0.0.1:10808"],
      ["service", "set", "env", "HTTP_PROXY", "http://127.0.0.1:10808"],
      ["service", "set", "env", "NO_PROXY", "127.0.0.1,localhost,::1"],
      ["service", "set", "env", "no_proxy", "127.0.0.1,localhost,::1"],
    ])
  })

  test("clearing the proxy removes every variable it wrote", async () => {
    const { command, read } = await recorded()

    await Effect.runPromise(applyToService(command, undefined))

    expect(await read()).toEqual([
      ["service", "unset", "env", "HTTPS_PROXY"],
      ["service", "unset", "env", "HTTP_PROXY"],
      ["service", "unset", "env", "NO_PROXY"],
      ["service", "unset", "env", "no_proxy"],
    ])
  })
})
