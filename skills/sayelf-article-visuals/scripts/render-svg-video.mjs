import { spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg || extname(inputArg).toLowerCase() !== '.svg' || extname(outputArg).toLowerCase() !== '.mp4') {
  console.error('用法：node scripts/render-svg-video.mjs <本地插图.svg> <输出视频.mp4>');
  process.exit(2);
}

const skillDir = dirname(fileURLToPath(import.meta.url));
const rootCandidates = [process.env.DRAFTLOOM_ROOT, resolve(skillDir, '..', '..', 'sayelf-draftloom'), resolve(skillDir, '..', '..', '..')].filter(Boolean);
let sharpPath;
for (const root of rootCandidates) {
  const candidate = resolve(root, 'node_modules', 'sharp', 'dist', 'index.mjs');
  try { await access(candidate); sharpPath = candidate; break; } catch { /* Try the next local Draftloom root. */ }
}
if (!sharpPath) {
  console.error('找不到本机 Draftloom 的 sharp 依赖；设置 DRAFTLOOM_ROOT 指向 Draftloom 项目目录后重试。');
  process.exit(2);
}
let sharp;
try { ({ default: sharp } = await import(pathToFileURL(sharpPath).href)); }
catch {
  console.error(`无法载入本机图片转换器：${sharpPath}`);
  process.exit(2);
}

const output = resolve(outputArg);
await mkdir(dirname(output), { recursive: true });
const scratch = await mkdtemp(resolve(tmpdir(), 'sayelf-article-video-'));
try {
  const frame = resolve(scratch, 'frame.png');
  await sharp(resolve(inputArg)).resize(1280, 720, { fit: 'contain', background: '#f7f6f2' }).png().toFile(frame);
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-n', '-loop', '1', '-framerate', '24', '-i', frame,
    '-vf', "zoompan=z='min(zoom+0.0004,1.04)':d=96:s=1280x720:fps=24,format=yuv420p",
    '-t', '4', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-movflags', '+faststart', output
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `ffmpeg exited with ${result.status}`);
  console.log(`已在本地生成 4 秒 MP4：${output}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
