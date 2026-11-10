export * as CodexPlugin from "./codex.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../../agent.js"
import PROMPT_CODEX_MAIN from "./codex-main.md" with { type: "text" }
import PROMPT_CODEX_CODER from "./codex-coder.md" with { type: "text" }
import PROMPT_CODEX_RESEARCHER from "./codex-researcher.md" with { type: "text" }
import PROMPT_CODEX_DOCS from "./codex-docs.md" with { type: "text" }
import PROMPT_CODEX_VERIFIER from "./codex-verifier.md" with { type: "text" }

export const Plugin = define({
  id: "opencode.codex",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("codex"), (item) => {
        item.name = Agent.Name.make("Codex")
        item.description =
          "OpenAI Codex 桌面主智能体：通用自主智能体，兼具权限审批把关、自主持久工作、清晰技术写作、伴生智能体编排与高质量产出物交付。"
        item.system = PROMPT_CODEX_MAIN
        item.mode = "all"
        item.native = true
      })

      editor.update(Agent.ID.make("codex-coder"), (item) => {
        item.name = Agent.Name.make("Codex Coder")
        item.description =
          "Codex 深度工程专家：专精复杂软件架构设计、根因缺陷修复、测试驱动开发、Git 隔离开发与高质量工程交付。"
        item.system = PROMPT_CODEX_CODER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("codex-researcher"), (item) => {
        item.name = Agent.Name.make("Codex Researcher")
        item.description =
          "Codex 深度调研专家：专精多轮源证据调研、学术级证据溯源、一手来源优先、声明到来源台账与矛盾证据调和。"
        item.system = PROMPT_CODEX_RESEARCHER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("codex-docs"), (item) => {
        item.name = Agent.Name.make("Codex Docs")
        item.description =
          "Codex 文档生产专家：专精 Word/Excel/PPT/PDF 现代办公文档生产、数据整理、专业报表排版与交付物质检。"
        item.system = PROMPT_CODEX_DOCS
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("codex-verifier"), (item) => {
        item.name = Agent.Name.make("Codex Verifier")
        item.description =
          "Codex 质检审计专家：独立验算逻辑、审查 Git 变更差异、核验测试充分性、覆盖边界用例与交付前质量把关。"
        item.system = PROMPT_CODEX_VERIFIER
        item.mode = "subagent"
        item.native = true
      })
    })
  }),
})
