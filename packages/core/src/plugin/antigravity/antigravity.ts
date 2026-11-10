export * as AntigravityPlugin from "./antigravity.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../../agent.js"
import PROMPT_BLACKBOARD_MANAGER from "./blackboard-manager.md" with { type: "text" }
import PROMPT_BROWSER_AGENT from "./browser-agent.md" with { type: "text" }
import PROMPT_CODE_ANALYSIS_EXPERT from "./code-analysis-expert.md" with { type: "text" }
import PROMPT_CODEBASE_NAV_EXPERT from "./codebase-nav-expert.md" with { type: "text" }
import PROMPT_CODING_WORKER from "./coding-worker.md" with { type: "text" }
import PROMPT_COMMAND_SAFETY_ADJUDICATOR from "./command-safety-adjudicator.md" with { type: "text" }
import PROMPT_COORDINATOR from "./coordinator.md" with { type: "text" }
import PROMPT_CRITIC_ORCHESTRATOR from "./critic-orchestrator.md" with { type: "text" }
import PROMPT_DEPENDENCY_AUDITOR from "./dependency-auditor.md" with { type: "text" }
import PROMPT_DISPATCH_ORCHESTRATOR from "./dispatch-orchestrator.md" with { type: "text" }
import PROMPT_DOCUMENT_INGESTOR from "./document-ingestor.md" with { type: "text" }
import PROMPT_INVESTIGATION_WORKER from "./investigation-worker.md" with { type: "text" }
import PROMPT_PIPELINE_CONDUCTOR from "./pipeline-conductor.md" with { type: "text" }
import PROMPT_PIPELINE_COORDINATOR from "./pipeline-coordinator.md" with { type: "text" }
import PROMPT_PROBLEM_DECOMPOSER from "./problem-decomposer.md" with { type: "text" }
import PROMPT_RESEARCH_SUBAGENT from "./research-subagent.md" with { type: "text" }
import PROMPT_REVIEWER from "./reviewer.md" with { type: "text" }
import PROMPT_SUBPROBLEM_SOLVER from "./subproblem-solver.md" with { type: "text" }
import PROMPT_SWARM_FOLLOWER from "./swarm-follower.md" with { type: "text" }
import PROMPT_SWARM_ORCHESTRATOR from "./swarm-orchestrator.md" with { type: "text" }
import PROMPT_SWARM_SYNTHESIZER from "./swarm-synthesizer.md" with { type: "text" }
import PROMPT_SYNTHESIZER from "./synthesizer.md" with { type: "text" }
import PROMPT_TEAMWORK_AGGREGATOR from "./teamwork-aggregator.md" with { type: "text" }
import PROMPT_TEAMWORK_CRITIC from "./teamwork-critic.md" with { type: "text" }
import PROMPT_TEAMWORK_EXPLORER from "./teamwork-explorer.md" with { type: "text" }
import PROMPT_TEAMWORK_INTERVIEWER from "./teamwork-interviewer.md" with { type: "text" }
import PROMPT_TEAMWORK_SPECIALIST from "./teamwork-specialist.md" with { type: "text" }
import PROMPT_TEST_WRITER from "./test-writer.md" with { type: "text" }
import PROMPT_TOOL_CALLING_AGENT from "./tool-calling-agent.md" with { type: "text" }

export const Plugin = define({
  id: "opencode.antigravity",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("agy-blackboard-manager"), (item) => {
        item.name = Agent.Name.make("Blackboard Manager")
        item.description = "维护 swarm 共享黑板文件。"
        item.system = PROMPT_BLACKBOARD_MANAGER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-browser-agent"), (item) => {
        item.name = Agent.Name.make("Browser Agent")
        item.description = "浏览器自动化子智能体。"
        item.system = PROMPT_BROWSER_AGENT
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-code-analysis-expert"), (item) => {
        item.name = Agent.Name.make("Code Analysis Expert")
        item.description = "代码分析专家：判断代码意图是否恶意。"
        item.system = PROMPT_CODE_ANALYSIS_EXPERT
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-codebase-nav-expert"), (item) => {
        item.name = Agent.Name.make("Codebase Nav Expert")
        item.description = "代码库导航专家。"
        item.system = PROMPT_CODEBASE_NAV_EXPERT
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-coding-worker"), (item) => {
        item.name = Agent.Name.make("Coding Worker")
        item.description = "编码 worker：理解原始任务、定位代码、实现改动、用真实测试验证边界用例。"
        item.system = PROMPT_CODING_WORKER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-command-safety-adjudicator"), (item) => {
        item.name = Agent.Name.make("Command Safety Adjudicator")
        item.description = "裁定 shell 命令是否安全可执行。"
        item.system = PROMPT_COMMAND_SAFETY_ADJUDICATOR
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-coordinator"), (item) => {
        item.name = Agent.Name.make("Coordinator")
        item.description = "纯协调者：不写码、不读文件、不跑命令，只把任务中继给 WorkerCheap/Judge/WorkerSmart。"
        item.system = PROMPT_COORDINATOR
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-critic-orchestrator"), (item) => {
        item.name = Agent.Name.make("Critic Orchestrator")
        item.description = "协调跨章节 critic 子 swarm，汇总为最终验证产物。"
        item.system = PROMPT_CRITIC_ORCHESTRATOR
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-dependency-auditor"), (item) => {
        item.name = Agent.Name.make("Dependency Auditor")
        item.description = "验证环境/依赖/构建约束是否满足。"
        item.system = PROMPT_DEPENDENCY_AUDITOR
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-dispatch-orchestrator"), (item) => {
        item.name = Agent.Name.make("Dispatch Orchestrator")
        item.description = "仅派发：必须经 invoke_subagent 委派所有工作，绝不直接写码。"
        item.system = PROMPT_DISPATCH_ORCHESTRATOR
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-document-ingestor"), (item) => {
        item.name = Agent.Name.make("Document Ingestor")
        item.description = "摄入 PDF 文档并提取内容。"
        item.system = PROMPT_DOCUMENT_INGESTOR
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-investigation-worker"), (item) => {
        item.name = Agent.Name.make("Investigation Worker")
        item.description = "调查 worker：挑战既有结论，产出独立调查报告。"
        item.system = PROMPT_INVESTIGATION_WORKER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-pipeline-conductor"), (item) => {
        item.name = Agent.Name.make("Pipeline Conductor")
        item.description = "多阶段 pipeline 指挥：分解目标为阶段、逐阶段派出 orchestrator、路由产物、处理循环。"
        item.system = PROMPT_PIPELINE_CONDUCTOR
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-pipeline-coordinator"), (item) => {
        item.name = Agent.Name.make("Pipeline Coordinator")
        item.description = "严格按系统提示词定义的 pipeline 编排，绝不亲自改码，只派发给 worker 子智能体。"
        item.system = PROMPT_PIPELINE_COORDINATOR
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-problem-decomposer"), (item) => {
        item.name = Agent.Name.make("Problem Decomposer")
        item.description = "把原始问题分解为主证明主干的子问题集，指定并行依赖关系。"
        item.system = PROMPT_PROBLEM_DECOMPOSER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-research-subagent"), (item) => {
        item.name = Agent.Name.make("Research Subagent")
        item.description = "只读探索代码库、读文件、搜索信息回传给主智能体。"
        item.system = PROMPT_RESEARCH_SUBAGENT
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-reviewer"), (item) => {
        item.name = Agent.Name.make("Reviewer")
        item.description = "判断重跑在更强模型上是否可能产出实质更好的结果，输出 ACCEPT/REJECT。"
        item.system = PROMPT_REVIEWER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-subproblem-solver"), (item) => {
        item.name = Agent.Name.make("Subproblem Solver")
        item.description = "解决分配的章节作为主证明主干的必要部分。"
        item.system = PROMPT_SUBPROBLEM_SOLVER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-swarm-follower"), (item) => {
        item.name = Agent.Name.make("Swarm Follower")
        item.description = "swarm worker：读取黑板，作出大胆贡献，写入 output_<id>.md 供 Synthesizer 汇总。"
        item.system = PROMPT_SWARM_FOLLOWER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-swarm-orchestrator"), (item) => {
        item.name = Agent.Name.make("Swarm Orchestrator")
        item.description = "并行 swarm 调度中枢：维护 worker 池，通过黑板持续派发同目标 worker，让复杂度经 stigmergy 涌现。"
        item.system = PROMPT_SWARM_ORCHESTRATOR
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-swarm-synthesizer"), (item) => {
        item.name = Agent.Name.make("Swarm Synthesizer")
        item.description = "把并行子智能体的产出合并为单一连贯结果，应用最终改动到用户工作区。"
        item.system = PROMPT_SWARM_SYNTHESIZER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-synthesizer"), (item) => {
        item.name = Agent.Name.make("Synthesizer")
        item.description = "把多份分析报告聚合成单一连贯评估，只处理报告不碰原始数据。"
        item.system = PROMPT_SYNTHESIZER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-teamwork-aggregator"), (item) => {
        item.name = Agent.Name.make("Aggregator")
        item.description = "汇总多份子分析报告：交叉引用、去重、解决冲突，产出带溯源的综合。"
        item.system = PROMPT_TEAMWORK_AGGREGATOR
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-teamwork-critic"), (item) => {
        item.name = Agent.Name.make("Critic")
        item.description = "对抗性挑战：压力测试假设、寻找失败模式、提出反例。"
        item.system = PROMPT_TEAMWORK_CRITIC
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-teamwork-explorer"), (item) => {
        item.name = Agent.Name.make("Explorer")
        item.description = "只读调查：分析问题、综合发现、产出结构化报告。"
        item.system = PROMPT_TEAMWORK_EXPLORER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-teamwork-interviewer"), (item) => {
        item.name = Agent.Name.make("Interviewer")
        item.description = "把原始请求转化为经批准的任务提示词。"
        item.system = PROMPT_TEAMWORK_INTERVIEWER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-teamwork-specialist"), (item) => {
        item.name = Agent.Name.make("Specialist")
        item.description = "外部领域专家：加载并遵循用户指定的 Antigravity skill 路径。"
        item.system = PROMPT_TEAMWORK_SPECIALIST
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-test-writer"), (item) => {
        item.name = Agent.Name.make("Test Writer")
        item.description = "为分配到的功能写全面测试。"
        item.system = PROMPT_TEST_WRITER
        item.mode = "subagent"
        item.native = true
      })

      editor.update(Agent.ID.make("agy-tool-calling-agent"), (item) => {
        item.name = Agent.Name.make("Tool Calling Agent")
        item.description = "按 <tools> 签名调用函数以协助用户查询。"
        item.system = PROMPT_TOOL_CALLING_AGENT
        item.mode = "subagent"
        item.native = true
      })


    })
  }),
})
