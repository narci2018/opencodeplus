export * as ZcodePlugin from "./zcode.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../../agent.js"
import PROMPT_ZCODE_MAIN from "./zcode-main.md" with { type: "text" }
import PROMPT_ZCODE_CODER from "./zcode-coder.md" with { type: "text" }
import PROMPT_ZCODE_EXPLORE from "./zcode-explore.md" with { type: "text" }
import PROMPT_ZCODE_PLANNER from "./zcode-planner.md" with { type: "text" }
import PROMPT_ZCODE_CUA from "./zcode-cua.md" with { type: "text" }
import PROMPT_ZCODE_SITE from "./zcode-site.md" with { type: "text" }

export const Plugin = define({
  id: "opencode.zcode",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("zcode"), (item) => {
        item.name = Agent.Name.make("ZCode")
        item.description =
          "智谱 ZCode 官方桌面主智能体：以高意图对齐、5阶段架构设计、全自主工程交付、桌面端深度集成与伴生专家协同为核心的综合性主导智能体。"
        item.system = PROMPT_ZCODE_MAIN
        item.mode = "all"
        item.native = true
      })

      editor.update(Agent.ID.make("zcode-coder"), (item) => {
        item.name = Agent.Name.make("ZCode Coder")
        item.description =
          "智谱 ZCode 核心工程专家：专精复杂任务全流程实现、精准文件修改、测试驱动验证与生产级质量把控。"
        item.system = PROMPT_ZCODE_CODER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("zcode-explore"), (item) => {
        item.name = Agent.Name.make("ZCode Explore")
        item.description =
          "智谱 ZCode 代码探索专家：专精高速只读文件模式匹配、全库代码检索、结构关系梳理与无副作用只读分析。"
        item.system = PROMPT_ZCODE_EXPLORE
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("zcode-planner"), (item) => {
        item.name = Agent.Name.make("ZCode Planner")
        item.description =
          "智谱 ZCode 架构规划专家：专精五阶段规划工作流、复用模式挖掘、上下文对齐、分步拆解与方案审批把关。"
        item.system = PROMPT_ZCODE_PLANNER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("zcode-cua"), (item) => {
        item.name = Agent.Name.make("ZCode CUA")
        item.description =
          "智谱 ZCode 桌面自动化专家：专精无障碍树语义感知、原生桌面应用操作、非抢占式 UI 交互与操作系统级任务驱动。"
        item.system = PROMPT_ZCODE_CUA
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("zcode-site"), (item) => {
        item.name = Agent.Name.make("ZCode Site")
        item.description =
          "智谱 ZCode Web 应用专家：专精现代化轻量前端原型构建、响应式交互设计、零构建负担交付与可视化呈现。"
        item.system = PROMPT_ZCODE_SITE
        item.mode = "subagent"
        item.native = true
      })
    })
  }),
})
