---
name: sayelf-draftloom
description: 公众号自动排版。将 Markdown/TXT/DOCX/PDF 稿件自动排版为微信公众号文章：本地文字识别、特殊符号清理、结构化编辑、图片插入、实时预览、去 AI 味、导出微信兼容 HTML。当用户提到 公众号排版、微信文章排版、公众号文章编辑、草稿生成 或 导出微信 HTML 时使用此技能。
agent_created: true
---

# 公众号自动排版（sayelf-draftloom）

基于 draftloom（本地优先的公众号排版工具，MVP v0.1）实现文字稿件到微信文章的自动排版。本仓库根目录即完整工具源码，克隆后可直接作为 WorkBuddy 技能使用。DOCX/PDF 由本地解析器提取文字，导入前自动清理 `*`、`#`、反引号等标记；扫描版 PDF 暂不做 OCR。

## 安装（WorkBuddy）

```bash
git clone https://github.com/chuanxituzhu-lab/sayelf-draftloom.git ~/.workbuddy/skills/sayelf-draftloom
```

运行 `npm install` 安装本地 DOCX/PDF 解析器。校验安装：在技能目录运行 `npm test`（当前应 51 个测试全部通过）。

## 何时使用

- 用户要求排版微信公众号文章、美化公众号稿件
- 导入 Markdown/TXT/DOCX/PDF 与图片，生成公众号文章
- 清空当前文章并重新上传；自动保留最近 12 篇文章记录，支持打开或删除
- 自动局部重点标注：识别重点词、金句、标题、核心句及“第 N”“一～N/一-N”编号，只对对应文字加粗或加浅色标记
- 一键提炼核心内容并在本机生成一张 900×383 标题图片，文案可继续人工修改
- 导出微信兼容 HTML 或生成本地交付包
- 去除文本 AI 味、切换文章主题

## 使用方式

以下命令均在技能目录（仓库根目录）运行。

### CLI（推荐 Agent 调用）

```bash
npm run cli -- init                                # 初始化文档
npm run cli -- import --article article.md --images ./images   # 导入稿件+图片
npm run cli -- import --text "文章内容" --image ./cover.png
npm run cli -- guidance                            # 自动排版指导
npm run cli -- text --text "标题：新的文章标题"      # 中文自然语言指令
npm run cli -- humanize --mode natural             # 去 AI 味（natural/conservative）
npm run cli -- export --out article.html           # 导出微信兼容 HTML
npm run cli -- publish --out .local-data/publish/latest  # 生成本地交付包
```

状态默认写入 `.local-data/document.json`，可用 `WECHAT_LAYOUT_DATA` 指定路径。

### GUI 可视化编辑

```bash
npm start   # 浏览器打开 http://127.0.0.1:4173
```

页面提供左右分栏编辑与微信实时预览，支持 Markdown/TXT/DOCX/PDF + 多图片拖放导入；DOCX/PDF 仅在本机识别，原稿保留用于回滚。换稿前会自动保存当前文章，也可以在“文章记录”中手动保存、打开或删除最近 12 篇文章。

### MCP

`npm run mcp` 启动 JSON-RPC stdio 服务，提供 `publishing_import`、`publishing_guidance`、`publishing_state`、`publishing_apply_text`、`publishing_humanize`、`publishing_apply_intent`、`publishing_export`、`publishing_publish` 工具。

## 中文自然语言指令示例

```text
标题：AI 时代的个人工作台
副标题：从工具堆叠走向统一运行时
添加标题：为什么需要统一排版层
添加段落：这是正文内容
添加引用：工具应该服务内容，而不是反过来。
第 3 段改成标题：关键结论
把当前改成引用
拆分当前段落
插入图片：cover
添加表格：指标|结果\n阅读量|1000
添加 CTA：继续阅读|打开文章|https://example.com
主题：杂志        （可选：极简 / 杂志 / 清新）
去 AI 味：自然
上移当前 / 下移当前 / 删除当前
```

## 核心规则

- Document State 是唯一内容事实源；所有内容变更经由 Intent → Reducer → VersionStore，自动写入 `revision + updatedAt`。
- 缩放等视图状态不得写入 Document State。
- 最多 50 个编辑版本，支持 Undo/Redo。
- `autoComposeVisuals({generate,autoImageCount,maxGenerated,titleMode,forceTitle,fillUnmatched})` 会按正文篇幅与章节密度自动计算正文配图预算，再将本地素材或创意图放到分布均匀的章节位置；`fillUnmatched:true` 也遵守预算，不会把素材库图片无上限追加到文章。
- “自动排版指导”支持“一键生成”：一次完成标题/配图编排，并在本机按章节层级、图片位置/内容、爆款标题和综合建议分组生成指导；每条结果保留“带入指令”作人工微调，不会未经确认直接改写正文。
- `publish` 默认只生成本地交付包，不上传。仅当显式配置 `WECHAT_ACCESS_TOKEN`（或 `WECHAT_APP_ID` + `WECHAT_APP_SECRET`）后才提交远程草稿；提交微信前，本机会把文章使用的 SVG 图片转换为 PNG 上传，编辑器中的原始 SVG 不变；Token 不写入文档或输出。扫码授权需要真实的授权适配器；配置 `WECHAT_QR_AUTH_URL` 后二维码由本机自动生成，配置 `WECHAT_QR_IMAGE_URL` 时直接显示已有二维码，本机回调只接收适配器提交的凭据，微信官方草稿接口本身不提供扫码登录。
