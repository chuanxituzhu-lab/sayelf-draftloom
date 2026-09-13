# Draftloom 公众号自动排版 v0.4.1

把 Markdown、TXT、DOCX、PDF 文章导入后，按**识别 → 去 AI 味（可选）→ 提炼 → 排版 → 审核 → 提交**工作流处理：完成本地识别、清理特殊符号、正文自然化、提炼核心、智能排版、生成封面、手机预览，最后导出微信 HTML 或提交到公众号草稿箱。新增“微信官方深色”可选视觉系统：深色底、绿色结构锚点、局部重点和居中留边图片。

适合需要稳定发布公众号文章，但不想反复复制、调整格式、找图片和改封面的人。

## 一句话看懂

**导入文章 → 识别 → 可选自然化 → 提炼 → 排版 → 审核 → 人工确认 → 导出或提交草稿。**

所有文章、图片和授权配置默认留在本机处理；不会因为排版而自动上传到云端。

## 三步开始使用

### 1. 准备 Node.js

安装 Node.js 20.16+ 或 22.3+，然后重新打开终端。

### 2. 下载项目

```bash
git clone https://github.com/chuanxituzhu-lab/sayelf-draftloom.git
cd sayelf-draftloom
```

旧地址 `https://github.com/chuanxituzhu-lab/draftloom` 会自动跳转到本项目。

### 3. 安装并打开

```bash
npm install
npm start
```

浏览器打开：<http://127.0.0.1:4173>

如果 4173 端口被占用，可在 Windows PowerShell 中运行：

```powershell
$env:PORT="4177"; npm start
```

然后打开 <http://127.0.0.1:4177>。

## 最新版本下载

当前最新版本：**v0.4.1**

- [打开 GitHub 仓库](https://github.com/chuanxituzhu-lab/sayelf-draftloom)
- [下载 v0.4.1 源码 ZIP](https://github.com/chuanxituzhu-lab/sayelf-draftloom/archive/refs/tags/v0.4.1.zip)
- [查看 v0.4.1 Skill 使用说明](https://github.com/chuanxituzhu-lab/sayelf-draftloom/blob/v0.4.1/skill/SKILL.md)

源码 ZIP 已包含最新 Skill、WebUI、命令行工具和本地工作流；本地独立导出包仍保存在 `.local-data/exports/`，不上传到公开仓库。

## 客户能直接得到什么

- **自动识别文章**：支持 Markdown、TXT、DOCX、PDF；DOCX/PDF 在本机提取文字。
- **自动清理格式**：去除 `*`、`#`、反引号等 Markdown/排版标记，保留正文内容。
- **自动提炼核心**：提取核心内容、生成标题候选、同步摘要和封面文案。
- **自动排版指导**：一键生成章节层级、图片位置与内容、爆款标题、综合建议；每条建议都保留“带入指令”。
- **自动匹配图片**：按文章长度、章节密度和图片语义安排正文配图，不会无上限塞图。
- **自动生成封面**：头条封面统一转换为 PNG/JPEG，标准尺寸为 **900×383**，自动居中裁剪。
- **手机效果预览**：右侧实时查看标题、摘要、正文、图片和封面在手机中的效果。
- **移动端安全排版**：正文宽度、行高和图片统一适配手机；图片自动居中，自动匹配的长正文不会重复变成大段图注。
- **一键优化排版**：自动统一中文字体栈、字号、行距和段距；拆分过长段落、整理章节层级，并只对重点词、金句和编号做局部加粗或色块标注。
- **统一视觉系统**：可切换“微信官方深色”主题，复用深色底、绿色重点、章节锚线、图片留边和低对比图注；默认主题不受影响。
- **重点局部标注**：识别重点词、金句、标题、核心句及“第 N”“一～N/一-N”，只标注重点，不整篇涂满。
- **去 AI 味可回退**：先生成正文修改预览，确认后才应用；自然化结果生成新版本，之后自动要求重新提炼、排版和审核。
- **反复换稿**：支持清空重新上传，最近 12 篇文章可在本机记录中打开或删除。
- **本地素材库**：图片可跨文章复用，也可以直接拖到“头条封面”。
- **微信交付**：导出微信兼容 HTML、本地草稿包；配置公众号接口后可提交远程草稿箱。
- **可回退发布工作流**：识别、自然化、提炼、排版、审核和提交各有独立状态与检查证据；自然化可跳过、预览或确认应用，上游重跑会自动让下游重新确认。

## 微信发布怎么工作

默认是本地模式：点击“导出到微信草稿箱”时，可以先生成本地草稿包。

需要直接提交公众号草稿箱时，再配置以下任一方式：

- `WECHAT_ACCESS_TOKEN`
- `WECHAT_APP_ID` + `WECHAT_APP_SECRET`

微信头条封面必须是 PNG/JPEG。系统提交前会再次检查标题、作者、摘要、正文大小、图片格式和封面尺寸。

扫码授权需要真实的授权适配器：

- 配置 `WECHAT_QR_AUTH_URL`：本机根据授权入口生成二维码。
- 配置 `WECHAT_QR_IMAGE_URL`：直接显示已有二维码。
- 授权适配器扫码完成后，将 `access_token` POST 到本机回调地址。

微信官方草稿接口本身不提供扫码登录；没有真实授权入口时，系统不会生成无效二维码。

## 隐私与安全

- 文章、图片、原稿、素材库和授权配置默认只在本机处理。
- `.local-data/` 已加入 Git 忽略，不会提交到 GitHub。
- AppSecret、Token、私钥、个人信息、IP 地址和本地文章不会写入公开代码或 README。
- DOCX/PDF 识别默认走本机 `127.0.0.1`；扫描版 PDF 当前暂不包含 OCR。
- 发布到公众号前仍建议人工审核标题、摘要、封面和正文。

## 常用功能

### 图形界面

```bash
npm start
```

### 本地检查

```bash
npm run check
npm test
```

### 命令行

```bash
npm run cli -- import --article article.md --images ./images
npm run cli -- workflow --article article.md --images ./images
npm run cli -- workflow --article article.md --humanize-mode natural
npm run cli -- workflow --article article.md --humanize-mode natural --apply-humanize true
npm run cli -- humanize-stage --mode natural
npm run cli -- humanize-stage --mode natural --apply true
npm run cli -- workflow --text "文章内容" --submit true
npm run cli -- format
npm run cli -- guidance
npm run cli -- export --out article.html
npm run cli -- publish --out .local-data/publish/latest
```

### 本地公众号配置

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-local.ps1 -AppId "你的AppID" -Port 4173
```

AppSecret 使用隐藏输入，仅保存为 Windows DPAPI 保护的本地配置，不会写入命令历史。

## 已下载旧版本，如何更新

在项目目录执行：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
npm install
npm run check
npm test
npm start
```

更新代码不会主动删除 `.local-data/`、浏览器文章、素材库或本地授权配置。升级前仍建议备份 `.local-data/`。

## v0.1.2 更新内容

- 优化三栏工作台、按钮、卡片、预览舞台和状态反馈的视觉层级。
- 手机预览与公众号提交统一使用真实 **900×383** 居中封面。
- 修复图片元数据尺寸不准确时的封面漏检问题。
- 页面重新渲染后保留编辑器、素材库和预览区域的滚动位置。
- README 改为面向客户的中文快速说明。

## v0.1.3 更新内容

- 自动从标题和正文提取去重关键词，生成可复制的 `#关键词`。
- 预览和导出微信 HTML 时，在文章末尾自动罗列关键词标签。
- 增加热点关联评估：区分可合理借势、谨慎借势和不建议硬蹭。
- 支持粘贴今日热点词进行本地复核；未提供热词时明确标记为待核验，不伪造实时热点。

## v0.1.4 更新内容

- 文章末尾仅保留 `#关键词`，移除多余的“关键词标签”提示文字。

## v0.1.6 更新内容

- 增加“一键优化排版”：统一字体、字号、行距、段距和标题层级。
- 自动拆分过长段落，优化手机端阅读节奏；安全识别章节提示并转为标题。
- 重点、金句和编号只做局部加粗或色块标注，不整段铺色；支持撤销回滚。
- 自动排版指导的一键生成会先执行版式优化，再生成配图、标题和指导建议。

## v0.2.0 更新内容

- 新增五阶段发布工作流：识别文字、提炼内容、自动排版、公众号审核、提交草稿箱。
- 每个阶段独立记录状态、结果和待处理问题；重跑上游阶段会使下游证据自动失效，避免误用旧审核结果。
- 新增 CLI `workflow`、MCP `publishing_workflow` 和 WebUI“一键执行1-4”。
- 默认只在本机完成前四阶段并准备草稿；只有显式确认且本机配置授权后，才调用微信草稿接口。

## v0.3.0 更新内容

- 增加可选“去 AI 味 / 人工自然”阶段，默认不改正文，先生成可核对的修改预览。
- 确认应用后保存为新版本，并自动让提炼、排版、审核和提交结果重新进入待确认状态。
- 工作流增加阶段契约、可选能力编排、检查点和本地运行证据记录；失败后可从受影响阶段恢复。
- WebUI 增加“生成修改预览”和“确认应用到正文”，避免自然化结果静默覆盖原稿。

## v0.4.0 更新内容

- 根据本地参考的公众号视觉规律新增“微信官方深色”主题：深色底、绿色结构锚点、低对比正文和局部重点。
- 自动排版时，官方深色主题的正文图片自动居中并保留 92% 最大宽度与轻边框，封面继续遵守 900×383。
- 新增 `docs/visual-system.md`，记录观察、推断、可验证事实和不复制参考资料的边界。

## v0.4.1 更新内容

- 修复顶部工具栏与工作流面板复用按钮 ID 导致面板“一键执行1-4”点击无效的问题。
- 顶部与面板按钮现在都只执行本地识别、提炼、排版和审核，不会自动提交公众号草稿箱。

## 许可证

本项目采用仓库中的 [LICENSE](LICENSE) 文件所示许可证。
