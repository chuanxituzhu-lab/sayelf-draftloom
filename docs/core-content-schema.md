# CoreContent v1：公众号提炼契约

`CoreContent` 是从当前“已接受正文”派生的本地推断对象，用于连接提炼、标题、摘要、封面和排版。它不是第二篇文章，也不能替换正文。

## 对象

```json
{
  "type": "CoreContent",
  "version": 1,
  "source": "local-deterministic",
  "epistemic": "inference",
  "localOnly": true,
  "thesis": "核心观点",
  "topic": "主题句",
  "problem": null,
  "method": null,
  "conclusion": null,
  "keywords": ["关键词"],
  "keySentences": [
    { "type": "CONCLUSION", "sentence": "正文中的关键原句。", "index": 0 }
  ]
}
```

字段规则：

- `thesis` 是文章最能代表主张的句子；`topic` 取最早的有效主题句。
- `problem` 只在正文明确表达痛点、困境、难点、限制或风险时填写。
- `method` 只在正文明确表达方法、步骤、建议、流程或做法时填写。
- `conclusion` 只在正文明确表达结论、因果判断或价值判断时填写。
- `keywords` 只是文章主题词，不代表实时热点；没有热榜输入就不宣称“蹭热点”。
- `keySentences` 保留正文原句、分类和原文索引，供人工回看；所有自动结果都标为 `epistemic: inference`。
- 没有明确证据的 `problem`、`method`、`conclusion` 保持 `null`，不靠模型猜测补齐。

## 标题与摘要元数据

标题和摘要不塞入 CoreContent，而是单独记录：

```json
{
  "title": "不超过 32 个 Unicode 字符",
  "digest": "不超过 128 个 Unicode 字符，避免重复标题",
  "titleSource": "auto",
  "digestSource": "auto",
  "contentSource": "article.md",
  "bodyRewritten": false,
  "requiresReview": true,
  "localOnly": true
}
```

`titleSource` / `digestSource` 只使用 `auto`、`human`、`source` 或 `placeholder` / `empty`。人工确认后的字段不被自动结果覆盖；需要重新计算时必须由用户显式触发。

## 阶段边界

识别阶段负责得到正文；可选的“去 AI 味”先给差异预览并等待确认；提炼阶段只读已接受正文；排版阶段消费 CoreContent 和正文但不改写语义；审核阶段检查微信约束；提交阶段只在显式确认后创建草稿。未来 AI Harness 如果接入，也必须返回同一对象、通过本机 `validateCoreContent`，并保留人工复核和本地数据边界。
