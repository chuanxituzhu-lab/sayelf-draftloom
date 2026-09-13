# Architecture — v0.4.0

```text
文章 / 图片拖放 / CLI / MCP
            │
            ▼
  ① Recognize · 识别文字
  importArticle + 本地 DOCX/PDF 提取
            │
            ▼
  ② Humanize · 去 AI 味（可选）
  预览 → 人工确认 → 正文新版本
            │
            ▼
  ③ Distill · 提炼内容
  核心观点 / 概要 / 标题候选 / 关键词
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
