export * as DshPlugin from "./dsh.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../../agent.js"
import PROMPT_DSH_MAIN from "./dsh-main.md" with { type: "text" }
import PROMPT_DSH_CODER from "./dsh-coder.md" with { type: "text" }
import PROMPT_DSH_RESEARCHER from "./dsh-researcher.md" with { type: "text" }
import PROMPT_DSH_PLANNER from "./dsh-planner.md" with { type: "text" }
import PROMPT_DSH_VERIFIER from "./dsh-verifier.md" with { type: "text" }

export const Plugin = define({
  id: "opencode.dsh",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("dsh"), (item) => {
        item.name = Agent.Name.make("DeepSeek Harness")
        item.description =
          "DeepSeek Harness 官方桌面主智能体：以极简上下文、严格无冗余定义、决策完备架构设计、伴生专家编排与全自主交付为核心的工程级主导智能体。"
        item.system = PROMPT_DSH_MAIN
        item.mode = "all"
        item.native = true
      })

      editor.update(Agent.ID.make("dsh-coder"), (item) => {
        item.name = Agent.Name.make("DSH Coder")
        item.description =
          "DeepSeek Harness 深度工程专家：专精复杂架构实现、根因缺陷修复、精准代码编辑、测试驱动验证与版本冲突自愈。"
        item.system = PROMPT_DSH_CODER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("dsh-researcher"), (item) => {
        item.name = Agent.Name.make("DSH Researcher")
        item.description =
          "DeepSeek Harness 深度调研专家：专精源码与网络深度检索、多轮证据链溯源、一手权威文档核实与零幻觉事实核验。"
        item.system = PROMPT_DSH_RESEARCHER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("dsh-planner"), (item) => {
        item.name = Agent.Name.make("DSH Planner")
        item.description =
          "DeepSeek Harness 架构规划专家：专精非变异代码库探索、决策完备系统设计、分阶段里程碑拆解与交付方案审批把控。"
        item.system = PROMPT_DSH_PLANNER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("dsh-verifier"), (item) => {
        item.name = Agent.Name.make("DSH Verifier")
        item.description =
          "DeepSeek Harness 质检审计专家：专精独立逻辑验算、Git 差异审计、单元与集成测试核验、边界用例覆盖与交付前质量把关。"
        item.system = PROMPT_DSH_VERIFIER
        item.mode = "subagent"
        item.native = true
      })
    })
  }),
})
