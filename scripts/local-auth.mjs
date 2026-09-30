import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const AUTH_FORMAT = 'draftloom-auth-dpapi-v1';

function dpapi(value, mode) {
  if (process.platform !== 'win32') throw new Error('扫码凭据持久化目前需要 Windows DPAPI');
  const script = mode === 'protect'
    ? '$secure=ConvertTo-SecureString -String ([Console]::In.ReadToEnd()) -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString -SecureString $secure))'
    : '$secure=ConvertTo-SecureString -String ([Console]::In.ReadToEnd().Trim()); $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }';
  try {
    const modulePath = [
      process.env.ProgramFiles ? join(process.env.ProgramFiles, 'WindowsPowerShell', 'Modules') : null,
      process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') : null
    ].filter(Boolean).join(';');
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input: value,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 128_000,
      env: { ...process.env, ...(modulePath ? { PSModulePath: modulePath } : {}) },
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    throw new Error('本机 DPAPI 凭据保护失败');
  }
}

export function authFilePath(root) {
  return join(root, '.local-data', 'wechat-auth.json');
}

export function saveProtectedAuth(root, input = {}) {
  if (!input.access_token || typeof input.access_token !== 'string') throw new Error('授权回调缺少 access_token');
  const saved = {
    format: AUTH_FORMAT,
    accessTokenProtected: dpapi(input.access_token, 'protect'),
    refreshTokenProtected: input.refresh_token ? dpapi(String(input.refresh_token), 'protect') : null,
    appid: input.appid || null,
    expires_at: input.expires_at || null,
    authorized_at: input.authorized_at || new Date().toISOString()
  };
  const path = authFilePath(root);
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  mkdirSync(join(root, '.local-data'), { recursive: true });
  writeFileSync(temporary, JSON.stringify(saved, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
  return { authorized: true, persisted: true, expiresAt: saved.expires_at };
}

export function readProtectedAuth(root) {
  let saved;
  try { saved = JSON.parse(readFileSync(authFilePath(root), 'utf8')); } catch { return null; }
  if (saved?.format === AUTH_FORMAT && saved.accessTokenProtected) {
    if (saved.expires_at && Date.parse(saved.expires_at) <= Date.now() + 30_000) return null;
    try {
      return {
        access_token: dpapi(saved.accessTokenProtected, 'unprotect'),
        refresh_token: saved.refreshTokenProtected ? dpapi(saved.refreshTokenProtected, 'unprotect') : null,
        appid: saved.appid || null,
        expires_at: saved.expires_at || null,
        authorized_at: saved.authorized_at || null
      };
    } catch { return null; }
  }
  // Migrate credentials written by older versions before using them again.
  if (saved?.access_token && process.platform === 'win32') {
    try {
      saveProtectedAuth(root, saved);
      return saved.expires_at && Date.parse(saved.expires_at) <= Date.now() + 30_000 ? null : saved;
    } catch { return null; }
  }
  return null;
}
