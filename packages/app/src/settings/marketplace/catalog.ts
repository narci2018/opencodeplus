export type PluginItem = {
  id: string
  name: string
  description: string
  category:
    | "常用精选"
    | "浏览器与爬虫"
    | "数据库与存储"
    | "开发与代码"
    | "系统与终端"
    | "办公与协同"
  author: string
  version: string
  tags: string[]
  featured?: boolean
  defaultConfig: {
    type: "local"
    command: string[]
    environment?: Record<string, string>
  }
}

export const MARKETPLACE_CATEGORIES = [
  "全部",
  "常用精选",
  "浏览器与爬虫",
  "数据库与存储",
  "开发与代码",
  "系统与终端",
  "办公与协同",
] as const

export const MARKETPLACE_PLUGINS: PluginItem[] = [
  {
    id: "playwright",
    name: "Playwright 浏览器自动化",
    description: "驱动无头与可视化 Chromium 浏览器，执行自动化网页端到端测试、数据抓取与界面交互。",
    category: "浏览器与爬虫",
    author: "Model Context Protocol Official",
    version: "1.2.0",
    tags: ["自动化", "Web测试", "爬虫", "Chromium"],
    featured: true,
    defaultConfig: {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-puppeteer"],
    },
  },
  {
    id: "fetch",
    name: "Web Fetch 网页检索器",
    description: "抓取指定 URL 网页内容，智能转换提取为结构化 Markdown，支持网络调研与实时信息检索。",
    category: "浏览器与爬虫",
    author: "Model Context Protocol Official",
    version: "1.0.4",
    tags: ["联网检索", "HTML解析", "网页提取"],
    featured: true,
    defaultConfig: {
      type: "local",
      command: ["uvx", "mcp-server-fetch"],
    },
  },
  {
    id: "sqlite",
    name: "SQLite 数据库助手",
    description: "连接本地 SQLite 数据库文件，执行模式分析、只读查询与数据统计，提供实时 SQL 提示。",
    category: "数据库与存储",
    author: "Model Context Protocol Official",
    version: "1.1.0",
    tags: ["SQLite", "SQL", "数据库", "数据分析"],
    featured: true,
    defaultConfig: {
      type: "local",
      command: ["uvx", "mcp-server-sqlite"],
    },
  },
  {
    id: "postgres",
    name: "PostgreSQL 数据库管理",
    description: "跨库分析与管理企业级 PostgreSQL 关系型数据库，执行复杂数据统计与模式分析。",
    category: "数据库与存储",
    author: "Model Context Protocol Official",
    version: "1.0.8",
    tags: ["Postgres", "SQL", "企业级数据库"],
    defaultConfig: {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-postgres"],
    },
  },
  {
    id: "github",
    name: "GitHub 协作连接器",
    description: "深度集成 GitHub API，检索 Issue、创建 Pull Request、审查代码分支与提交历史。",
    category: "开发与代码",
    author: "Model Context Protocol Official",
    version: "2.1.0",
    tags: ["GitHub", "Git", "PR审查", "Issue管理"],
    featured: true,
    defaultConfig: {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-github"],
    },
  },
  {
    id: "git",
    name: "Git 仓库版本控制增强",
    description: "深入分析 Git 差异、历史 Commit、分支合并与冲突诊断，自动生成规范提交日志。",
    category: "开发与代码",
    author: "Model Context Protocol Official",
    version: "1.0.2",
    tags: ["Git", "版本管理", "Commit规范", "Diff诊断"],
    defaultConfig: {
      type: "local",
      command: ["uvx", "mcp-server-git"],
    },
  },
  {
    id: "filesystem",
    name: "文件系统高级沙盒工具",
    description: "提供安全受限的文件系统目录读写、元数据提取、哈希校验与全文搜索能力。",
    category: "系统与终端",
    author: "Model Context Protocol Official",
    version: "1.3.1",
    tags: ["文件操作", "沙盒", "全文检索"],
    defaultConfig: {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
    },
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking 深度思考推理",
    description: "提供多步思维链推理与假设验证工具，增强智能体在面对极复杂工程问题时的推演能力。",
    category: "常用精选",
    author: "Model Context Protocol Official",
    version: "1.0.5",
    tags: ["思维链", "复杂推理", "架构推演"],
    featured: true,
    defaultConfig: {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
    },
  },
  {
    id: "docker",
    name: "Docker 容器与镜像运维",
    description: "查看本地与远程 Docker 容器生命周期、日志流、网络与 Compose 服务部署状态。",
    category: "系统与终端",
    author: "Community",
    version: "1.1.2",
    tags: ["Docker", "容器", "DevOps", "服务部署"],
    defaultConfig: {
      type: "local",
      command: ["uvx", "mcp-server-docker"],
    },
  },
  {
    id: "feishu",
    name: "飞书 / Lark 办公连接器",
    description: "读取与更新飞书多维表格 (Bitable)、云文档 (Docs) 与项目任务卡片，打通企业协同场景。",
    category: "办公与协同",
    author: "Bytedance Open Platform",
    version: "2.0.1",
    tags: ["飞书", "Lark", "多维表格", "协同办公"],
    featured: true,
    defaultConfig: {
      type: "local",
      command: ["npx", "-y", "feishu-mcp-server"],
    },
  },
  {
    id: "memory-graph",
    name: "Memory 长期知识图谱记忆",
    description: "基于实体抽取与知识图谱的长期持久化认知网络，实现跨会话、跨项目事实检索与沉淀。",
    category: "常用精选",
    author: "Model Context Protocol Official",
    version: "1.0.6",
    tags: ["知识图谱", "记忆网络", "实体关系"],
    defaultConfig: {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
    },
  },
  {
    id: "python-runner",
    name: "Python 数据分析与图表渲染",
    description: "快速在隔离环境中运行 Python 脚本，支持 Pandas / Numpy / Matplotlib 数据分析处理。",
    category: "开发与代码",
    author: "Community",
    version: "1.2.3",
    tags: ["Python", "数据清洗", "图表生成", "科学计算"],
    defaultConfig: {
      type: "local",
      command: ["uvx", "mcp-server-python"],
    },
  },
]
