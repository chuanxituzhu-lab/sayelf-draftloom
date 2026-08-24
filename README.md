# 公众号排版 MVP v0.1.1

本地优先、无第三方依赖的公众号文章可视化排版 MVP。

版本号以 `package.json` 为唯一来源。运行 `npm run version:sync` 会同步界面徽标、MCP 服务版本、Harness 文档和 README；合并到 GitHub `main` 后，`.github/workflows/version-sync.yml` 会自动递增 patch 版本并提交回仓库。

## 已实现

- 文字指令 → 文档状态 → GUI/预览同步
- GUI 可视化直接编辑 → 文档状态 → 右侧预览同步
- 微信文章实时预览，60%–140% 独立缩放；缩放不修改文档数据- 文章块新增 / 修改 / 删除 / 上下移动
- 本地图片素材库、点击插入文章
- Markdown / TXT + 多图片拖放导入，自动识别标题、章节、段落、引用和图片引用
- 内容驱动的智能视觉编排：自动提炼标题、生成标题图，并按章节语义匹配素材或生成本地创意 SVG 占位图
- 封面一键设置：根据封面与内容摘要设置区，智能复用素材库中的合规封面，置为文章首图并同步摘要
- 独立封面与摘要设置区：封面素材、900×383 头条比例、主/副文案和 ≤128 字摘要集中编辑，右侧预览按公众号顺序同步
- 智能标题工作流：从全文生成摘要和 5 个证据绑定的爆款标题候选，自动采用第一候选，人工选择任一候选后即锁定标题
- 跨文章本地素材库：导入的新图和自动生成创意图会自动入库；下一篇文章可按语义复用并自动填充，素材库容量 200 张
- 图片智能导入：点击“图片智能导入”会读取图片文件名、alt/描述以及可选的 OCR/视觉标签，识别图片内容后与章节语义匹配，将素材库中尚未使用的图片一键放到文章相应位置，支持回滚
- 主流程为“导入文章+图片 → 自动总结/配图/入库 → 人工编排 → 导出到微信草稿箱”；素材库可单独上传，也会接收导入与生成结果
- 自动排版指导面板：提示长段落、缺少层级、未匹配图片，并可一键带入人工指令
- PingPongGrowth 创作画像：按公众号定位、读者、语气和关键词分析文章，并生成标题/结构/CTA 建议
- 自然语言指导编辑：区块转换、长段落拆分、按序号修改、组件创建
- 本地 Humanizer：自然化 / 保守调整两种模式，原稿可回滚
- 冻结语义组件：列表、表格、CTA、画廊、媒体，并支持 Markdown/指令创建
- 五套 MVP 主题：极简、杂志、清新、墨韵、暖阳；切换主题会同步改变工作区、编辑器和右侧预览
- “一键检测”：按微信公众号字段、正文、封面和排版建议统一检查，先自动修正可安全修正项，再提示仍需人工处理的内容
- “智能优化发布约束”：点击后自动蒸馏正文、同步标题/作者/摘要/封面主副文案，并按“封面 → 标题 → 作者/时间 → 内容摘要 → 正文”动态重排公众号预览；原稿始终保留
- 封面辅助：按 900×383 / 383×383 规范生成 SVG 候选，检查比例与文件大小，最终由人工确认
- 微信交付包：导出微信兼容 HTML、草稿 payload 和 manifest；配置接口后可提交远程草稿
- Harness JS API，可由外部 Agent/自动化层调用
- 时间戳 + revision 序列号版本机制
- 最多 50 个编辑版本，支持 Undo / Redo
- localStorage 本地持久化
- 内部文档状态 JSON（供 CLI/MCP 与自动化交换；普通用户无需手动处理）
- Node 原生测试，无第三方运行依赖

## 启动

```bash
cd wechat-layout-mvp
npm run test
npm start
```

浏览器打开：`http://127.0.0.1:4173`
CLI / MCP 接入：

```bash
npm run cli -- import --article article.md --images ./images
npm run cli -- import --text "文章内容" --image ./cover.png
npm run cli -- guidance
npm run cli -- cover --out .local-data/cover
npm run cli -- cover-import --image ./assets/covers/draftloom-wechat-preview-cover.jpg --width 900 --height 383
npm run cli -- visuals --max-generated 3
npm run cli -- cover-set
npm run cli -- viral-title
npm run cli -- assets-fill
npm run cli -- growth
npm run cli -- growth-brief
npm run cli -- wechat-check
npm run cli -- wechat-optimize
npm run cli -- text --text "标题：AI 时代的个人工作台"
npm run cli -- humanize --mode natural
npm run cli -- export --out article.html
npm run cli -- publish --out .local-data/publish/latest
npm run cli -- draft-status
npm run cli -- draft-submit --confirm true