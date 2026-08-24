# `files (1).zip` 融合说明

压缩包中的 `wechat-draft-push` 设计已融合到现有 `wechat-layout` 运行时，没有再维护一套平行发布工具：

| 压缩包能力 | 现有项目落点 |
|---|---|
| Markdown → 微信 inline-style HTML | `src/core.js` 的 `renderArticleHtml()` |
| `WX_APPID` / `WX_APPSECRET` 环境变量 | `scripts/cli.mjs` 与服务端状态检查兼容 |
| 正文图 `media/uploadimg` | `scripts/cli.mjs` 的远程草稿提交 |
| 首图永久素材 `material/add_material` | `scripts/cli.mjs` 自动生成 `thumb_media_id` |
| `draft/add` 后停止 | `delivery.status=submitted`，返回 `draftId`，设置 `reviewRequired` |
| 人工扫码确认边界 | GUI 授权适配器 + 本机回调，不自动群发 |

因此 GUI、CLI、MCP 和本地 Skill 共用同一份文章状态、图片上传和草稿提交逻辑。压缩包中的 Python 脚本仍可作为独立迁移参考，但不作为运行时必需依赖。
