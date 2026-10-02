$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 24 或更新版本。' }
if (!(Test-Path -LiteralPath 'node_modules')) {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw '安装依赖失败。' }
}
$ports = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort)
if (($ports -contains 4310) -and ($ports -contains 4311)) {
    Write-Output '本机预览端口已占用。若是本项目服务，可直接访问 http://127.0.0.1:4311；不会自动终止已有进程。'
} elseif ($ports -contains 4310) {
    Write-Output '服务端端口已占用，启动网页预览；请确认现有服务端属于本项目。地址：http://127.0.0.1:4311'
    npm run dev:web -- --strictPort
} elseif ($ports -contains 4311) {
    Write-Output '网页端口已占用，仅启动本项目服务端。'
    npm run dev:api
} else {
    Write-Output '正在启动本项目，打开 http://127.0.0.1:4311。保持此窗口运行。'
    npm run dev
}
