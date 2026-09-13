---
name: wechat-layout
description: Run a local-first Chinese WeChat Official Account publishing workflow with DOCX/PDF text extraction, special-marker cleanup, optional humanization, content distillation, deterministic layout, reference-derived visual systems, WeChat review, explicit draft submission, the document reducer, GUI harness, CLI commands, MCP stdio tools, undo/redo, local image assets, and HTML export. Use when working on 公众号排版、微信文章结构化编辑、内容提炼、去 AI 味、发布审核、图片插入、视觉主题或本地预览。
---

# 公众号排版 Skill — v0.4.0

## Purpose

将文字稿转换为微信公众号草稿的可回退工作流，并保持 GUI、文档状态、微信预览和提交结果一致。默认顺序为：识别 → 去 AI 味（可选）→ 提炼 → 排版 → 审核 → 提交。

## Workflow contract

固定职责为：

1. `recognizeArticleStage`：本地识别文字、Markdown、DOCX、PDF，清理展示标记并生成结构化区块；原稿只读保留。
2. `humanizeArticleStage`（可选）：先生成正文差异预览；只有人工确认后才应用自然化新版本，不修改事实、数字、引用和核心观点。
3. `distillArticleStage`：基于已接受的正文提炼核心观点、内容概要、标题候选和关键词；默认不改写正文，人工标题不会被覆盖。
4. `layoutArticleStage`：统一字体、字号、行距、段距和标题层级，拆分过长段落，局部标注重点，并按章节密度安排图片/封面。
5. `reviewArticleStage`：检查标题、作者、摘要、正文字符/大小、封面、图片和 HTML；只自动修安全项，错误与建议都保留在报告中。
6. `prepareWorkflowSubmission` + 现有提交适配器：生成微信 payload；只有用户显式确认且授权可用时，才上传图片并创建草稿，绝不代替后台群发。

`runPublishingWorkflow` 负责按依赖串联本地阶段并准备提交，不直接产生网络副作用。工作流状态写入 `doc.meta.workflow`：每个阶段都有 `status`、`at`、`report` 和 handoff；自然化预览会停在人工闸门，应用后自动让提炼、排版、审核和提交结果失效；阶段转换、检查点和证据写入本地 ledger，提交结果通过 `recordWorkflowSubmission` 写回。

## State rule

- Document State 是唯一内容事实源。
- View State（例如 preview zoom）不得写入 Document State。
- 所有内容变更必须经由 Intent -> Reducer -> VersionStore。
- 每次有效内容变更自动写入 `revision + updatedAt`。

## Harness entry

浏览器运行时：`window.wechatLayoutHarness`

### Read

- `getState()`：返回完整文档快照。
- `getWorkflowState()`：返回阶段状态、审核结果、检查点、运行证据和是否可以提交。

### Write

- `applyText(text)`：提交中文自然语言编辑指令。
- `applyIntent(intent, label?)`：提交结构化 Intent。
- `addImage({name,type,dataUrl,alt})`：新图片进入素材库。
- `replaceSelectedImage(assetId)`：用素材库图片替换当前选中的图片区块。
- `deleteImage(assetId)`：从素材库删除素材，并同步移除文章/画廊中的对应图片引用；支持 undo/redo。
- `importArticle({text,filename,assets})`：导入已提取的文章文字与本地图片，自动清理 `*`、`#`、反引号等展示标记、总结正文、生成爆款标题候选、建立章节/段落/引用和图片块；浏览器导入还会把图片写入跨文章本地素材库。GUI 的 DOCX/PDF 识别通过本机 `/api/extract-document` 完成，原始稿件保留用于回滚。
- `publishingWorkflow()`：在当前文档上运行识别、可选自然化、核心提炼、自动排版和公众号审核本地阶段，并显示提交是否已准备好；不自动联网。
- `humanizePreview(mode)` / `humanizeApply()` / `humanizeSkip()`：生成去 AI 味正文预览，人工确认应用或保留原文跳过；应用后自动要求重新提炼、排版和审核。
- GUI 提供“清空重传”和“文章记录”：换稿前自动保存当前稿件，最近 12 篇文章结构保存在浏览器本机；记录可重新打开或删除，图片引用复用本地素材库。
- 导入或编辑时，普通段落保持原样；重点词、金句、标题、核心句及“第 N”“一～N/一-N”编号只在对应文字范围内加粗或加浅色标记，状态可随文章版本一起回滚。
- `generateTitleImage`：本地提炼文章核心内容，生成一张 900×383 标题图片并写入素材库，标题和摘要仍可人工修改。
- `autoComposeVisuals({generate,autoImageCount,maxGenerated,titleMode,forceTitle,fillUnmatched})`：先按正文篇幅与章节密度计算正文配图预算，再识别图片文件名、描述以及可选的 OCR/视觉标签，将素材/本地创意图插入分布均匀的章节；`fillUnmatched:true` 也遵守预算，不会把剩余素材库图片无上限追加。每个匹配图片区块会记录置信度、命中关键词、内容标签和识别来源，生成结果可人工替换、移动或删除。`forceTitle:true` 仅用于用户主动点击“生成爆款标题”，人工编辑过的标题默认锁定。
- `coverSet()`：根据封面与内容摘要设置区，优先复用素材库中的合规封面，置为文章首图，并依据核心提炼结果同步摘要、封面主文案和副文案；若没有合规封面才生成一个可替换候选，不重复导入已有素材。`smartCover()` 作为内部兼容别名保留。
- 扫码授权：配置真实 `WECHAT_QR_AUTH_URL` 后由本机自动渲染二维码；配置 `WECHAT_QR_IMAGE_URL` 可直接显示已有二维码。无真实授权入口时不生成伪造二维码，扫码成功后仍需适配器 POST `access_token` 到本机回调。
- GUI 的“公众号封面与内容摘要”独立设置区提供封面素材选择、900×383 头条预览、主/副文案（10/14 字）和内容摘要（128 字）编辑；手工封面文案会锁定，重新执行智能设置可解除锁定并按正文重算。
- “我的素材”图片卡片可直接拖入“头条封面”替换，保留封面下拉选择和“封面一键设置”；SVG 拖入后沿用提交前本地 PNG/JPEG 转换。
- GUI 的“自动排版指导”提供“一键生成”：一次完成标题/配图编排，并本地分组生成章节层级、图片位置/内容、爆款标题和综合建议；每条结果保留“带入指令”作人工微调，不会未经确认直接修改正文。
- 微信草稿提交：文章使用的 SVG 图片在本机提交前自动转换为 PNG，解决微信图片接口不接受 SVG 的问题；预览和原始素材不变。
- GUI 与 CLI 会区分本机连接失败、文档识别失败、微信图片上传失败和草稿接口失败，显示具体处理阶段与下一步，不再只显示 `fetch failed`。
- `optimizeWechat()`：按共享微信限制智能蒸馏正文，并同步优化标题、作者、内容摘要、封面主/副文案；预览按“封面 → 标题 → 作者/时间 → 内容摘要 → 正文”动态重排，结果可通过 undo/redo 回滚。
- `checkWechat()`：一键执行微信字段、正文、封面和排版检查；先自动修正可安全修正项，再返回仍需人工处理的问题。
- `selectBlock(id)`：GUI 选择块。
- `undo()` / `redo()`：版本回滚/重做。

## MVP Intents

```json
[
  {"type":"setTitle","text":"文章标题"},
  {"type":"setSubtitle","text":"副标题"},
  {"type":"appendBlock","blockType":"heading","text":"章节标题","level":2},
  {"type":"appendBlock","blockType":"paragraph","text":"正文"},
  {"type":"appendBlock","blockType":"quote","text":"引用"},
  {"type":"updateBlock","id":"block-id","text":"新内容"},
  {"type":"deleteSelected"},
  {"type":"moveSelected","direction":-1},
  {"type":"moveSelected","direction":1},
  {"type":"addAsset","asset":{"id":"asset-id","name":"cover.png","type":"image/png","size":0,"dataUrl":"data:image/png;base64,...","alt":"封面"}},
  {"type":"addAssets","assets":[{"id":"asset-id","name":"cover.png","type":"image/png","size":0,"dataUrl":"data:image/png;base64,...","alt":"封面"}]},
  {"type":"insertAsset","assetId":"asset-id"},
  {"type":"replaceSelectedAsset","assetId":"asset-id"},
  {"type":"deleteAsset","assetId":"asset-id"},  {"type":"insertAssetByName","name":"cover"},
  {"type":"convertSelected","blockType":"quote"},
  {"type":"splitSelected"},
  {"type":"setTheme","theme":"editorial"},
  {"type":"setTheme","theme":"ink"},
  {"type":"setTheme","theme":"sunset"},
  {"type":"humanize","mode":"natural"},
  {"type":"autoComposeVisuals","generate":true,"autoImageCount":true,"maxGenerated":3,"titleMode":"viral"},
  {"type":"smartCover"},
  {"type":"optimizeWechat"}
]
```

## Natural-language examples

主题目录包含六套：极简、杂志、清新、墨韵、暖阳、微信官方深色。切换主题会同步刷新工作区容器、编辑区、工具栏和右侧预览；“微信官方深色”来自参考截图的视觉规律提炼，不复制其文章内容或品牌素材。完整规则见 `docs/visual-system.md`。

公众号预览固定保留封面图位置和内容摘要位置：已有首图作为封面，缺图时显示待补位提示；封面文案与摘要来自文档状态，优化后会同步刷新，不直接修改原稿。

- `标题：AI 时代的个人工作台`
- `副标题：从工具堆叠走向统一运行时`
- `添加标题：为什么需要统一排版层`
- `添加段落：这是正文内容`
- `添加引用：工具应该服务内容，而不是反过来。`
- `上移当前`
- `下移当前`
- `删除当前`
- `插入图片：cover`
- `替换当前图片：cover`- `把当前改成引用`
- `拆分当前段落`
- `添加表格：指标|结果\n阅读量|1000`
- `主题：杂志`
- `主题：墨韵` / `主题：暖阳`
- `主题：微信官方深色`
- `去 AI 味：自然`
- `智能配图`
- `提炼核心并生成标题图`
- `封面一键设置`
- `爆款标题`
- `图片智能导入`
- `智能自动化优化修改执行微信公众号发布约束`
- `一键检测`

## Event

每次内容状态改变，页面派发：`wechat-layout:changed`。

## 公众号增长创作画像

`growth` 与 `growth-brief` 根据公众号定位、读者、语气、关键词和 CTA 生成合规检查、增长建议与创作简报。增长分数仅供人工编辑参考，不影响草稿安全边界，也不会自动发布。

```bash
npm run cli -- growth
npm run cli -- growth-brief
npm run cli -- wechat-optimize
```

Harness 还提供 `getGrowthProfile()`、`setGrowthProfile(profile)`、`analyzeGrowth(profile)` 和 `growthBrief(profile)`。
## CLI / MCP 接入

在项目根目录运行：

```bash
npm run cli -- init
npm run cli -- import --article article.md --images ./images
npm run cli -- workflow --article article.md --images ./images
npm run cli -- workflow --article article.md --humanize-mode natural
npm run cli -- workflow --article article.md --humanize-mode natural --apply-humanize true
npm run cli -- humanize-stage --mode natural
npm run cli -- humanize-stage --mode natural --apply true
npm run cli -- workflow --text "文章内容" --submit true
npm run cli -- distill
npm run cli -- layout-stage
npm run cli -- review
npm run cli -- import --text "文章内容" --image ./cover.png
npm run cli -- guidance
npm run cli -- cover --out .local-data/cover
npm run cli -- cover-import --image ./assets/covers/draftloom-wechat-preview-cover.jpg --width 900 --height 383
npm run cli -- visuals --max-generated 3
npm run cli -- cover-set
npm run cli -- viral-title
npm run cli -- assets-fill
npm run cli -- wechat-check
npm run cli -- text --text "标题：新的文章标题"
npm run cli -- humanize --mode natural
npm run cli -- export --out article.html
npm run cli -- publish --out .local-data/publish/latest
npm run cli -- draft-status
npm run cli -- draft-submit --confirm true
