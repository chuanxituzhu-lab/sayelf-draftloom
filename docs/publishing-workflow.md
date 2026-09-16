# Draftloom 公众号发布工作流

## 目标

把一篇本地文章稳定地变成“可审核、可回退、可提交”的微信公众号草稿。工作流将内容处理和远程副作用分开：识别、自然化、提炼、排版和审核只在本机完成，提交阶段必须经过用户确认。

## 六个阶段（自然化为可选节点）

| 阶段 | 负责人 | 输入 | 输出 | 是否联网 |
| --- | --- | --- | --- | --- |
| 1. 识别文字 | `recognizeArticleStage` | TXT、Markdown、DOCX、PDF 及本地图片 | 本地 Markdown 中间稿、结构化标题/段落/引用/图片区块；识别告警 | 否 |
| 2. 去 AI 味（可选） | `humanizeArticleStage` | 已识别的结构化正文 | 自然化预览，或人工确认后的新正文版本 | 否 |
| 3. 提炼内容 | `distillArticleStage` | 已接受的正文 | `CoreContent v1`（主题/问题/方法/结论/关键词/证据句）、标题候选、内容概要及来源元数据 | 否 |
| 4. 自动排版 | `layoutArticleStage` | 结构化文章和内容分析结果 | 字体/字号/行距/段距、标题层级、局部重点、封面和图片位置 | 否 |
| 5. 公众号审核 | `reviewArticleStage` | 最终排版文档 | 字段、正文、图片、封面和 HTML 检查；安全修正与人工建议 | 否 |
| 6. 提交草稿箱 | `prepareWorkflowSubmission` + 提交适配器 | 审核通过的 payload | 本地草稿包，或经确认后创建公众号草稿 | 按授权决定 |

## 职责边界

- 识别阶段只负责“读懂文件结构”，不负责标题营销或排版美化。
- DOCX 识别优先调用 Microsoft 开源 MarkItDown 的本地流式适配器；不可用时由 Mammoth 生成语义 HTML，再由 Turndown 转为 Markdown。转换只在本机进行，保留原文件名和原始输入边界。
- 自然化阶段只处理表达，不静默覆盖原稿；必须先预览，应用后保存新版本，并把下游结果标记为过期。
- 提炼阶段基于已接受的正文生成可核对的 `CoreContent v1`，把主题、问题、方法、结论和关键证据句分开；不静默改写正文，手工标题和摘要保持锁定。
- 排版阶段只改变视觉结构和图片位置，不改变文章观点。
- 审核阶段可以自动修正安全的长度、摘要和封面文案问题，但保留原稿和剩余问题。
- 提交阶段不代替公众号后台群发；它只创建草稿，最终发布由人工完成。

## 状态和回退

阶段结果写入 `Document State.meta.workflow`，每个阶段包含 `status`、`at`、`report` 和 handoff。状态可能是 `not-run`、`skipped`、`complete`、`needs-review`、`blocked`、`ready`、`submitted` 或 `stale`。阶段转换会追加到本地 evidence ledger，并生成可恢复的 checkpoint。

重新执行任意上游阶段时，所有下游阶段标记为 `stale`，必须重新排版或审核后才能提交。自然化预览属于 `NEEDS_REVIEW`，不能绕过人工确认直接进入提炼。文章正文和原始导入内容仍由 `VersionStore` 与 `original` 保存，可用 Undo/Redo 回退。

## 默认调用

```bash
npm run cli -- workflow --article article.md --images ./images
```

这会依次完成识别、跳过可选自然化、提炼、排版、审核，并准备本地提交状态，不调用远程服务。启用自然化时，先只生成预览：

```bash
npm run cli -- workflow --article article.md --humanize-mode natural
```

确认预览后再应用并继续：

```bash
npm run cli -- workflow --article article.md --humanize-mode natural --apply-humanize true
```

只有明确要求提交时才使用：

```bash
npm run cli -- workflow --article article.md --images ./images --submit true
```

`--submit true` 仍受公众号授权、IP 白名单、图片转换和微信草稿接口检查约束；失败会记录具体阶段和错误，不把 `fetch failed` 当作唯一信息。

## 事实边界

- 本地提炼结果属于 `Inference`，`CoreContent` 的字段不是事实；标题和摘要中的事实仍需人工核对。
- `CoreContent.keySentences` 只保留正文原句和位置索引，供人工回看证据；没有明确表达的问题、方法或结论保持 `null`，不靠猜测补齐。
- 标题/摘要元数据记录 `titleSource`、`digestSource`、`contentSource`、`bodyRewritten`、`requiresReview` 和 `localOnly`，用于判断是否可以交给排版和审核阶段。
- 微信接口返回的草稿编号才是提交成功的 `Fact`。
- 没有实时热榜输入时，关键词只表示文章主题，不声称是热点。
- 公众号后台最终审核和群发不由本地工具代替。

## 工作流原则落地

- 能力匹配：自然化作为可选能力，未启用时不增加执行成本。
- 依赖优先：自然化必须先于提炼；提炼结果必须先于排版；审核通过必须先于提交。
- 人工闸门：仅对可能改变正文的自然化设置确认闸门，常规识别和排版不打断用户。
- 结果版本：正文自然化每次应用都生成新版本，原稿、差异、阶段报告和提交结果可追溯。
- 安全恢复：自然化预览失败或被拒绝时，原正文仍可用；恢复从 `humanize` 检查点继续，不要求重新导入。
