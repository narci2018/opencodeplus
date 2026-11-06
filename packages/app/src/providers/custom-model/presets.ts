import type { Config } from "@opencode/schema/config"

export type CustomModelProtocol = "openai-compatible" | "anthropic-compatible" | "google" | "ollama" | "openrouter"

export type ProtocolPreset = {
  /** Stable protocol id used by the form and the config entry. */
  id: CustomModelProtocol
  /** i18n key for the protocol display name. */
  labelKey: string
  /** The provider carrier package registered in the config `providers` entry. */
  package: string
  /** The carrier's canonical provider id. */
  canonical: string
  /** Default baseURL placeholder for the form. */
  baseURL: string
  /** Default baseURL used when the user leaves the field blank. */
  defaultBaseURL?: string
  /** Whether the protocol needs an API key. */
  apiKey: "required" | "optional" | "none"
  /** Whether the baseURL is user-editable (Ollama/OpenRouter presets are not). */
  editableBaseURL: boolean
  /** Default model id placeholder. */
  modelIDPlaceholder: string
  /** Whether the protocol carries a fixed model family that only needs a model id. */
  fixedFamily?: boolean
}

const CARRIERS = {
  openai: "@opencode/ai/providers/openai-compatible",
  anthropic: "@opencode/ai/providers/anthropic-compatible",
  google: "@opencode/ai/providers/google",
  openrouter: "@opencode/ai/providers/openrouter",
} as const

export const PROTOCOL_PRESETS: Record<CustomModelProtocol, ProtocolPreset> = {
  "openai-compatible": {
    id: "openai-compatible",
    labelKey: "settings.models.custom.protocol.openaiCompatible",
    package: CARRIERS.openai,
    canonical: "openai-compatible",
    baseURL: "https://api.openai.com/v1",
    apiKey: "optional",
    editableBaseURL: true,
    modelIDPlaceholder: "gpt-4o",
  },
  "anthropic-compatible": {
    id: "anthropic-compatible",
    labelKey: "settings.models.custom.protocol.anthropicCompatible",
    package: CARRIERS.anthropic,
    canonical: "anthropic-compatible",
    baseURL: "https://api.anthropic.com/v1",
    apiKey: "required",
    editableBaseURL: true,
    modelIDPlaceholder: "claude-sonnet-4-5",
  },
  google: {
    id: "google",
    labelKey: "settings.models.custom.protocol.google",
    package: CARRIERS.google,
    canonical: "google",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "required",
    editableBaseURL: true,
    modelIDPlaceholder: "gemini-2.5-pro",
  },
  ollama: {
    id: "ollama",
    labelKey: "settings.models.custom.protocol.ollama",
    package: CARRIERS.openai,
    canonical: "openai-compatible",
    baseURL: "http://localhost:11434/v1",
    defaultBaseURL: "http://localhost:11434/v1",
    apiKey: "none",
    editableBaseURL: true,
    modelIDPlaceholder: "llama3.1",
  },
  openrouter: {
    id: "openrouter",
    labelKey: "settings.models.custom.protocol.openrouter",
    package: CARRIERS.openrouter,
    canonical: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    defaultBaseURL: "https://openrouter.ai/api/v1",
    apiKey: "required",
    editableBaseURL: false,
    modelIDPlaceholder: "anthropic/claude-sonnet-4.5",
  },
}

export const PROTOCOL_IDS = Object.keys(PROTOCOL_PRESETS) as CustomModelProtocol[]

/** The id under which a custom provider is registered in the config `providers` map. */
export function providerID(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "custom-model"
}

/** Builds the config `providers` entry value for one custom model. */
export function providerPatch(input: {
  id: string
  name: string
  protocol: CustomModelProtocol
  baseURL: string
  apiKey?: string
  modelID: string
}): Config.ProviderPatch {
  const preset = PROTOCOL_PRESETS[input.protocol]
  const baseURL = input.baseURL.trim() || preset.defaultBaseURL || preset.baseURL
  const settings: { baseURL: string; apiKey?: string } = { baseURL }
  if (preset.apiKey !== "none" && input.apiKey?.trim()) settings.apiKey = input.apiKey.trim()
  return {
    id: input.id,
    package: preset.package,
    canonical: preset.canonical,
    name: input.name.trim(),
    settings,
    models: { [input.modelID.trim()]: { name: input.modelID.trim() } },
  }
}

/** A config `providers` entry as read back for the custom-model list. */
export type CustomProviderEntry = {
  id: string
  name?: string
  package?: string
  canonical?: string
  baseURL?: string
  apiKey?: string
  models?: Record<string, { name?: string }>
}

/** The structural shape of a config entry the UI reads; both SDK and schema `Entry` satisfy it. */
type ConfigEntryLike = {
  type: string
  info?: { providers?: Record<string, unknown> }
}

export function readProviderEntries(entries: readonly ConfigEntryLike[]): CustomProviderEntry[] {
  const result: CustomProviderEntry[] = []
  for (const entry of entries) {
    if (entry.type !== "document") continue
    for (const [id, provider] of Object.entries(entry.info?.providers ?? {})) {
      if (typeof provider !== "object" || provider === null) continue
      const value = provider as Record<string, unknown>
      // Only entries backed by a known carrier package are surfaced as custom models.
      const packageValue = typeof value.package === "string" ? value.package : undefined
      if (!packageValue || !Object.values(CARRIERS).includes(packageValue as (typeof CARRIERS)[keyof typeof CARRIERS])) continue
      const settings = (value.settings ?? {}) as Record<string, unknown>
      const models: Record<string, { name?: string }> = {}
      for (const [modelID, model] of Object.entries((value.models ?? {}) as Record<string, unknown>)) {
        if (typeof model === "object" && model !== null) {
          const modelValue = model as Record<string, unknown>
          models[modelID] = { name: typeof modelValue.name === "string" ? modelValue.name : modelID }
        } else {
          models[modelID] = { name: modelID }
        }
      }
      result.push({
        id,
        name: typeof value.name === "string" ? value.name : id,
        package: packageValue,
        canonical: typeof value.canonical === "string" ? value.canonical : undefined,
        baseURL: typeof settings.baseURL === "string" ? settings.baseURL : undefined,
        apiKey: typeof settings.apiKey === "string" ? settings.apiKey : undefined,
        models: Object.keys(models).length > 0 ? models : undefined,
      })
    }
  }
  // Highest-precedence document wins; later entries in the list are lower priority.
  const seen = new Set<string>()
  return result.filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)))
}
