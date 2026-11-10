export * as ClaudePlugin from "./claude.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../../agent.js"
import PROMPT_CLAUDE_MAIN from "./claude-main.md" with { type: "text" }
import PROMPT_CLAUDE_COWORK from "./claude-cowork.md" with { type: "text" }
import PROMPT_CLAUDE_CODER from "./claude-coder.md" with { type: "text" }
import PROMPT_CLAUDE_RESEARCHER from "./claude-researcher.md" with { type: "text" }
import PROMPT_CLAUDE_VERIFIER from "./claude-verifier.md" with { type: "text" }

export const Plugin = define({
  id: "opencode.claude",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("claude"), (item) => {
        item.name = Agent.Name.make("Claude")
        item.description =
          "Claude 官方桌面主智能体：王者级桌面智能体系统，兼具任务规划、主动交互澄清、高质量产出物交付与伴生智能体编排。"
        item.system = PROMPT_CLAUDE_MAIN
        item.mode = "all"
        item.native = true
      })

      editor.update(Agent.ID.make("claude-cowork"), (item) => {
        item.name = Agent.Name.make("Claude Cowork")
        item.description =
          "Claude 协同办公专家：专精 Word/Excel/PPT/PDF 现代办公文档处理、数据整理与专业报表排版设计。"
        item.system = PROMPT_CLAUDE_COWORK
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("claude-coder"), (item) => {
        item.name = Agent.Name.make("Claude Coder")
        item.description =
          "Claude 深度工程专家：专精软件架构设计、复杂工程实现、Git 隔离开发、缺陷修复与测试驱动开发。"
        item.system = PROMPT_CLAUDE_CODER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("claude-researcher"), (item) => {
        item.name = Agent.Name.make("Claude Researcher")
        item.description =
          "Claude 深度调研专家：专精多源技术检索、文献调研、学术级证据溯源与全网知识对比综合。"
        item.system = PROMPT_CLAUDE_RESEARCHER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("claude-verifier"), (item) => {
        item.name = Agent.Name.make("Claude Verifier")
        item.description =
          "Claude 质检审计专家：落实 verification_step 规范，独立验算逻辑、审查 Git 变更、覆盖边界用例与质量把关。"
        item.system = PROMPT_CLAUDE_VERIFIER
        item.mode = "subagent"
        item.native = true
      })
    })
  }),
})
