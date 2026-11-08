---
name: TRAE-browseruse
description: 浏览器自动化操作指南（从 Trae CN TRAE-browseruse 移植）
user_invocable: false
---

# TRAE Browser Use

## 使用场景

当需要使用浏览器完成以下任务时加载此技能：
- 访问网页并提取内容
- 自动化表单填写和交互
- 网页截图和验证
- 网页测试和调试

## 工具集

浏览器 MCP 服务器提供以下工具（26个）：

| 工具 | 描述 |
|------|------|
| browser_navigate | 导航到 URL |
| browser_snapshot | 获取页面快照 |
| browser_click | 点击元素 |
| browser_fill | 填写表单 |
| browser_select | 选择下拉框 |
| browser_press | 按键 |
| browser_evaluate | 执行 JavaScript |
| browser_screenshot | 截图 |
| browser_wait_for | 等待元素/条件 |
| browser_upload_file | 上传文件 |
| browser_handle_dialog | 处理对话框 |
| browser_hover | 悬停元素 |
| browser_drag | 拖拽元素 |
| browser_take_snapshot | 页面状态快照 |
| browser_list_pages | 列出页面 |
| browser_select_page | 选择页面 |
| browser_close_page | 关闭页面 |
| browser_list_console_messages | 列出控制台消息 |
| browser_list_network_requests | 列出网络请求 |

## 执行规则

1. **顺序执行**：浏览器操作必须顺序执行，不得并行
2. **引用管理**：使用 `ref` 引用元素，避免重复查找
3. **禁止 Promise.all**：浏览器调用禁止使用 Promise.all
4. **等待用户交互**：`browser_waiting_for_user_interaction` 必须独立调用（不在 Exec 内）

## 注意事项

- 截图返回的路径需要手动 Read 查看
- 页面加载后需等待网络空闲
- 敏感信息（密码、Token）不入日志
