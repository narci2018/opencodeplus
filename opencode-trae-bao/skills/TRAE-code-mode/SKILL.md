---
name: TRAE-code-mode
description: 代码模式编排指南（从 Trae CN TRAE-code-mode-orchestrator 移植）
user_invocable: false
---

# TRAE Code Mode

## 使用场景

当任务需要复杂编排时使用 Exec 工具：
- 并行 fan-out（多文件/多任务同时处理）
- 数据依赖（后一步依赖前一步结果）
- 条件分支（根据条件选择不同路径）
- 循环迭代（处理批量数据）

## 决策树

```
请求 → 是否涉及 fan-out? → 是 → Code Mode
     → 是否涉及数据转换? → 是 → Code Mode
     → 是否涉及验证? → 是 → Code Mode
     → 否则 → 直接工具调用
```

## Exec 沙箱环境

### 全局变量
- `tools` — 工具调用代理
- `ALL_TOOLS` — 只读工具列表
- `text(value)` — 输出结果（JSON.stringify）
- `exit()` — 提前终止
- `image(rawToolResult)` — 处理截图

### 约束
- ❌ 无文件系统访问
- ❌ 无网络访问（fetch 不可用）
- ❌ 无 require/process/Buffer
- ❌ 无 console/setTimeout
- ✅ 仅 ECMAScript 标准内置对象

## 硬限制

- 最多 30 次 Exec 调用
- 最长 10 分钟执行时间
- 超过限制必须停止并重试

## 使用模式

### 1. 并行 fan-out
```javascript
const results = await Promise.all(
  items.map(item => tools.WebSearch(item))
);
text({ status: "completed", count: results.length });
```

### 2. 数据依赖
```javascript
const data = await tools.Read("input.json");
const parsed = JSON.parse(data);
const result = await tools.Write("output.json", JSON.stringify(parsed, null, 2));
text({ status: "completed" });
```

### 3. 条件分支
```javascript
const file = await tools.Read("config.json");
if (file.includes("production")) {
  await tools.RunCommand("npm run build");
} else {
  await tools.RunCommand("npm run dev");
}
text({ status: "completed" });
```
