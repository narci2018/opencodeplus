export * as RulesFiles from "./rules-files.js"

import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { Config } from "./config.js"
import { Project } from "./project.js"

const globalConfigDir = () =>
  process.env.OPENCODE_CONFIG_DIR ||
  (process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "opencode")
    : path.join(os.homedir(), ".config", "opencode"))

const projectMemoryPath = (canonical: string) => path.join(canonical, ".opencode", "memory", "MEMORY.md")

const readFileContent = (filepath: string) => (existsSync(filepath) ? readFileSync(filepath, "utf8") : null)

/**
 * Read model behind the settings rules & memory page. The caller provides Config.Service from the
 * location context, and this read model resolves files using standard Node filesystem calls.
 */
export const get = (config: Config.Interface, projectsService: Project.Interface, directory?: string) =>
  Effect.gen(function* () {
    const entries = yield* config.entries()
    const documents = entries.filter((entry) => entry.type === "document")
    const rules = documents.flatMap((entry) => (entry.info.rules ? [entry.info.rules] : [])).at(-1)
    const memory = documents.flatMap((entry) => (entry.info.memory ? [entry.info.memory] : [])).at(-1)
    const instructions = documents.flatMap((entry) => (entry.info.instructions ? [entry.info.instructions] : [])).at(-1)

    const globalConfig = globalConfigDir()
    const projectList = yield* projectsService.list().pipe(Effect.orElseSucceed(() => []))
    const projects = projectList.map((p) => ({
      projectID: String(p.id),
      name: p.name || path.basename(p.canonical) || String(p.id),
      directory: p.canonical,
      path: projectMemoryPath(p.canonical),
    }))

    const targetDirectory = directory || projects[0]?.directory
    const projectMemory = targetDirectory
      ? { path: projectMemoryPath(targetDirectory), content: readFileContent(projectMemoryPath(targetDirectory)) }
      : undefined

    return {
      rules: {
        agents_md: rules?.agents_md ?? true,
        claude_md: rules?.claude_md ?? false,
      },
      instructions: instructions ?? [],
      globalAgents: { path: path.join(globalConfig, "AGENTS.md"), content: readFileContent(path.join(globalConfig, "AGENTS.md")) },
      ...(targetDirectory ? { projectAgents: { path: path.join(targetDirectory, "AGENTS.md"), content: readFileContent(path.join(targetDirectory, "AGENTS.md")) } } : {}),
      memory: {
        enabled: memory?.enabled ?? true,
        distill: memory?.distill ?? true,
        global: { path: path.join(globalConfig, "memory", "MEMORY.md"), content: readFileContent(path.join(globalConfig, "memory", "MEMORY.md")) },
        ...(projectMemory ? { project: projectMemory } : {}),
        projects,
      },
    }
  })
