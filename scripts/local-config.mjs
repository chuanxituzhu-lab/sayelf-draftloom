import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Reads the optional Windows DPAPI configuration without writing the secret
 * to a command line, log, browser, or document state. On non-Windows hosts or
 * when no local config exists this is a no-op, so env-based deployments keep
 * working unchanged.
 */
export function loadProtectedLocalConfig(root) {
  if (process.platform !== 'win32') return null;
  const configPath = join(root, '.local-data', 'draftloom.config.json');
  if (!existsSync(configPath)) return null;
  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
  if (!config?.appId || !config?.appSecretProtected) return null;
  const safePath = configPath.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference='Stop'",
    `$config=Get-Content -Raw -LiteralPath '${safePath}' | ConvertFrom-Json`,
    "$secure=ConvertTo-SecureString ([string]$config.appSecretProtected)",
    "$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    "try { $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }",
    "[ordered]@{ appId=[string]$config.appId; appSecret=$plain; port=[string]$config.port } | ConvertTo-Json -Compress"
  ].join(';');
  try {
    const modulePath = [
      process.env.ProgramFiles ? join(process.env.ProgramFiles, 'WindowsPowerShell', 'Modules') : null,
      process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') : null
    ].filter(Boolean).join(';');
    const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      env: { ...process.env, ...(modulePath ? { PSModulePath: modulePath } : {}) }
    }).trim();
    const value = JSON.parse(output);
    return value?.appId && value?.appSecret ? value : null;
  } catch {
    return null;
  }
}

export function applyProtectedLocalConfig(root) {
  const value = loadProtectedLocalConfig(root);
  if (!value) return null;
  if (!process.env.WECHAT_APP_ID) process.env.WECHAT_APP_ID = value.appId;
  if (!process.env.WECHAT_APP_SECRET) process.env.WECHAT_APP_SECRET = value.appSecret;
  if (!process.env.PORT && value.port) process.env.PORT = value.port;
  return value;
}
