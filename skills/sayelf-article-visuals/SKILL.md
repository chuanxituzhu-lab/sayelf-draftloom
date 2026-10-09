---
name: sayelf-article-visuals
description: Use when creating local, article-aware illustrations or a cover for a WeChat article, choosing a RAL-inspired palette, or automatically placing generated visuals at matching article sections; keeps article text and assets local and reuses Draftloom's JavaScript renderer.
---

# SAYELF Article Visuals

Generate restrained, article-specific visuals locally and place them at the matching article locations. Use the existing SAYELF Draftloom renderer and document workflow; do not create a second editor, duplicate its SVG composer, or send article text/assets to image-generation websites.

## Workflow

1. Locate the active local Draftloom installation. Read the accepted article and its structured blocks locally; do not infer facts absent from the article.
2. Reuse `src/visuals.js` (`autoComposeDocument`, `createCreativeAsset`) to make a cover and section SVGs. Select section anchors by semantic relevance and use the existing budget/confidence rules. Insert each image immediately after its matched section anchor. Do not place unmatched imagery merely to fill a quota.
3. Prefer the built-in default palettes. The `ral-inspired` palette is a visual style only, not an official RAL mapping. Use exact RAL codes/colors only when a locally available user-licensed palette source is explicitly configured; preserve its attribution/license requirements. Never invent official codes or scrape/copy the protected RAL collection.
4. Keep text editable and concise, avoid putting long paragraphs into graphics, and treat generated assets as replaceable suggestions. Preserve original article text and allow Undo/replacement.
5. Review the generated cover and placements in the existing WebUI. Report generated asset count, insertion anchors, skipped low-confidence placements, palette provenance, and any conversion limitations accurately.

## Local rendering contract

- JavaScript generates SVG from local article semantics; no remote image API, browser service, external font, or telemetry is required.
- Cover headline/subhead text is rendered by the existing local SVG/Canvas/compositing code; never send article copy or source imagery to a third-party renderer. Preserve the source image and reuse the same locally rendered derivative in preview, HTML export, and publishing; keep user edits authoritative.
- Draftloom converts SVG to a WeChat-compatible raster format locally during submission. Keep the original SVG in the local asset library for editing.
- For a request specifically asking for a short video, first check local FFmpeg availability, render the SVG to MP4 with `scripts/render-svg-video.mjs`, and keep the result local. This creates a 4-second subtle-motion video from one local illustration. Treat it as a separate output path: do not claim it has been inserted into a WeChat article unless the active Draftloom renderer/exporter supports and verifies that media block. Do not send a `file://` or localhost media URL to the public account.
- If a requested local renderer or licensed palette is unavailable, stop that branch or use the clearly labeled RAL-inspired fallback; never report an unavailable render as complete.

## Boundaries

- This Skill covers article-related local visuals, not general image generation or engineering/CAD animation; route those requests to the relevant shared visual or drawing Skill.
- No automatic publishing. Draft submission remains under Draftloom's review and explicit-confirmation workflow.
- Do not upload local article text, images, generated files, credentials, or licensed RAL color tables to GitHub or other public services without explicit public classification and release review.
