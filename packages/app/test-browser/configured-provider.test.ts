import { describe, expect, test } from "bun:test"
import {
  providerEntryPatch,
  readAllProviderEntries,
  readProviderEntries,
} from "@/providers/custom-model/presets"

const document = (providers: Record<string, unknown>, type = "document") => ({ type, info: { providers } })

describe("configured provider entries", () => {
  test("reads carrier-backed and unmanaged config entries with their disabled state", () => {
    const entries = readAllProviderEntries([
      document({
        zro: {
          package: "@opencode/ai/providers/openai-compatible",
          canonical: "openai-compatible",
          name: "ZRO",
          settings: { baseURL: "https://api.zro.test/v1", apiKey: "sk-zro" },
          models: { "zro-1": { name: "ZRO 1" } },
        },
        google: { name: "Google", settings: { baseURL: "https://google.test" }, disabled: true },
      }),
    ])

    expect(entries.map((entry) => entry.id)).toEqual(["zro", "google"])
    expect(entries[0]).toMatchObject({
      id: "zro",
      name: "ZRO",
      baseURL: "https://api.zro.test/v1",
      apiKey: "sk-zro",
      models: { "zro-1": { name: "ZRO 1" } },
      disabled: false,
      unmanaged: false,
    })
    expect(entries[1]).toMatchObject({ id: "google", disabled: true, unmanaged: true })

    // The custom-model list stays limited to entries the protocol picker can safely rewrite.
    expect(
      readProviderEntries([document({ zro: { package: "@opencode/ai/providers/openai-compatible" }, google: {} })]).map(
        (entry) => entry.id,
      ),
    ).toEqual(["zro"])
  })

  test("a disable patch carries every field because config.update replaces the entry", () => {
    const entry = readAllProviderEntries([
      document({
        zro: {
          package: "@opencode/ai/providers/openai-compatible",
          canonical: "openai-compatible",
          name: "ZRO",
          settings: { baseURL: "https://api.zro.test/v1", apiKey: "sk-zro" },
          models: { "zro-1": { name: "ZRO 1" } },
        },
      }),
    ])[0]!

    expect(providerEntryPatch(entry, true)).toEqual({
      id: "zro",
      package: "@opencode/ai/providers/openai-compatible",
      canonical: "openai-compatible",
      name: "ZRO",
      settings: { baseURL: "https://api.zro.test/v1", apiKey: "sk-zro" },
      models: { "zro-1": { name: "ZRO 1" } },
      disabled: true,
    })
    expect(providerEntryPatch(entry, false)).toMatchObject({ id: "zro", disabled: false })
  })

  test("an entry without settings is not given a synthetic empty baseURL", () => {
    const entry = readAllProviderEntries([document({ plain: { name: "Plain", disabled: true } })])[0]!
    const patch = providerEntryPatch(entry, false)
    expect(patch.settings).toBeUndefined()
    expect(patch).toEqual({ id: "plain", name: "Plain", disabled: false })
  })

  test("the highest-precedence document wins for a duplicated id", () => {
    const entries = readAllProviderEntries([
      document({ shared: { name: "Winner", disabled: true } }),
      document({ shared: { name: "Lower" } }),
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: "Winner", disabled: true })
  })
})
