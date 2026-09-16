# Architecture — v0.4.5

```text
文章 / 图片拖放 / CLI / MCP
            │
            ▼
  ① Recognize · 识别文字
  importArticle + DOCX→Markdown + 本地 PDF/TXT 规范化
            │
            ▼
  ② Humanize · 去 AI 味（可选）
  预览 → 人工确认 → 正文新版本
            │
            ▼
  ③ Distill · 提炼内容
  CoreContent v1 / 概要 / 标题候选 / 关键词
            │
            ▼
  ④ Layout · 自动排版
  autoFormat + 图片预算/位置 + 本地封面
            │
            ▼
  ⑤ Review · 公众号审核
  微信字段 / 正文大小 / 图片 / HTML
            │
            ▼
  ⑥ Submit · 草稿箱
  本地 payload → 显式确认 → 微信适配器
            │
       ┌────┴──────────┐
       ▼               ▼
 VersionStore      Persist
 seq+timestamp     localStorage/CLI
       │
       ▼
 Single Document State + Original + meta.workflow + reference-derived visual theme
       │
 ┌─────┼──────────────┬───────────┐
 ▼     ▼              ▼           ▼
Guidance Humanizer  Theme      Preview
GUI     stage+diff  5 packs    zoom-only
```

原则：文档状态是唯一内容事实源，`original` 保存导入原稿，`working copy` 经过 reducer/VersionStore 修改；阶段契约、handoff、checkpoint 和证据 ledger 写入 `meta.workflow`，供 GUI、CLI、MCP 共用。自然化预览不改变正文，人工确认后才创建新正文版本。预览缩放属于 View State，不进入文档状态，因此不会造成内容版本变化。识别、自然化、提炼、排版和审核默认在本机完成；上游阶段重跑会使下游证据变为 `stale`。未匹配或未引用图片不会静默丢弃，而是转为提示或交给人工确认。交付默认生成本地包，远程接口只有用户显式确认且本机授权可用后才调用。

## CoreContent v1

`distillArticleStage` 从当前已接受正文生成唯一的本地推断对象：`type`、`version`、`source`、`epistemic`、`localOnly`、`thesis`、`topic`、`problem`、`method`、`conclusion`、`keywords` 和 `keySentences`。`keySentences` 保留正文原句、`TOPIC/PROBLEM/METHOD/CONCLUSION` 类型和原文索引；未被正文明确表达的字段为 `null`。标题/摘要另存元数据，不把 CoreContent 当成第二篇文章，也不改写正文。交给排版前必须通过 `validateCoreContent`，发布前仍需人工复核。

## Shared Motion Layer

GSAP 作为项目共享能力挂在 WebUI/预览层：`src/motion.js` 提供统一的动画调用、响应式条件、`prefers-reduced-motion` 适配和生命周期清理。它不参与工作流阶段，不写入 Document State，不进入微信 HTML 导出；页面默认只注册 `window.draftloomMotion`，需要动效的模块直接复用，不重复建设动效底座。
