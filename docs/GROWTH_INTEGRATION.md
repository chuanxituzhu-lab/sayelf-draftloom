# PingPongGrowth × draftloom

`draftloom` 已将 `chuanxituzhu-lab/pingpong-growth-pipeline` 的核心能力以本地 JavaScript 模块接入，不引入 Python 运行时，也不复制一套发布流程。

## 接入内容

- 公众号创作画像：定位、读者、语气、关键词和 CTA；
- 合规检查：标题/正文/封面、长度、敏感表述和人工审核边界；
- 增长建议：开场钩子、标题前置关键词、关键词覆盖、正文信息密度、封面和 CTA；
- 创作简报：标题方向、开场、文章结构、互动引导和人工编辑要求；
- GUI、CLI、MCP 和 Harness 共用同一份画像与分析结果。

增长分数是建议，不会自动发布，也不会绕过微信草稿确认。微信提交仍然只调用 `draft/add`，最终由人工在公众号后台审核和发送。

## CLI

```bash
npm run cli -- growth
npm run cli -- growth-brief
npm run cli -- growth --profile .local-data/growth-profile.json
```

画像文件示例：

```json
{
  "accountName": "SAYELF山野精灵",
  "positioning": "山野茶事、自然生活与真实体验",
  "audience": "喜欢茶、自然生活和山野体验的人",
  "tone": "自然、真诚、克制、温暖",
  "targetKeywords": ["山野精灵", "山野茶", "自然生活", "茶"],
  "cta": "如果你也喜欢这样的山野生活，欢迎留言交流。"
}
```

## GUI / Harness

左侧“公众号创作画像”面板可以编辑画像并生成分析报告。页面 Harness 暴露：

```js
window.wechatLayoutHarness.getGrowthProfile()
window.wechatLayoutHarness.setGrowthProfile({ positioning: '山野茶事与自然生活' })
window.wechatLayoutHarness.analyzeGrowth()
window.wechatLayoutHarness.growthBrief()
```

## MCP

新增工具：

- `publishing_growth_analyze`：返回合规结果、增长信号和修改建议；
- `publishing_growth_brief`：返回基于公众号画像的创作简报。

两者都只读/生成建议，不会上传草稿或发布内容。
