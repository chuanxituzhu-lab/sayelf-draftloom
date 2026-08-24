# Draftloom 后台运行

推荐使用 Windows 登录自启动：电脑登录后自动启动本机 Draftloom，服务持续运行；公众号 AppSecret 使用当前 Windows 用户 DPAPI 加密保存，不进入仓库、命令行参数或日志。

## 一次性配置

在项目目录执行：

```powershell
cd F:\wechat-layout-mvp-v0.1\wechat-layout-mvp
npm run configure:local
```

按提示输入 AppID 和新的 AppSecret。配置会写入 `.local-data/draftloom.config.json`，该目录已被 `.gitignore` 排除。

## 手动后台启动

```powershell
npm run start:background
```

启动后访问 `http://127.0.0.1:4177/`。关闭当前 PowerShell 窗口不会停止服务。
`npm start` 仍然是前台调试模式；如果要关闭终端，请使用上面的后台命令。

## 登录后自动启动

配置完成后执行一次：

```powershell
npm run autostart:install
```

之后每次 Windows 登录会自动启动 Draftloom。移除任务：

```powershell
npm run autostart:remove
```

日志位置：

```text
.local-data/draftloom-server.log
.local-data/draftloom-server.error.log
```

这是本机服务。电脑关机、睡眠或网络出口 IP 改变时，服务无法继续对外调用微信 API；微信 API 白名单仍需填写当前公网出口 IP。
