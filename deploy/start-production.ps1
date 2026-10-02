param(
    [string]$EnvFile = (Join-Path $PSScriptRoot '.env.production'),
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw '找不到环境文件，请复制 deploy/.env.production.example 为 deploy/.env.production 并填写。'
}
$resolvedEnv = (Resolve-Path -LiteralPath $EnvFile).Path
$composeFile = Join-Path $PSScriptRoot 'docker-compose.yml'
if (!(Get-Command docker -ErrorAction SilentlyContinue)) { throw '未找到 Docker，请先安装并启动支持 Linux 容器的 Docker。' }
$composeArgs = @('compose', '--env-file', $resolvedEnv, '-f', $composeFile)
$previousQianEnvFile = $env:QIAN_ENV_FILE
try {
    $env:QIAN_ENV_FILE = $resolvedEnv
    # 静默校验，避免展开后的密钥被打印；每步失败立即停止。
    & docker @composeArgs config --quiet
    if ($LASTEXITCODE -ne 0) { throw '生产配置校验失败，未启动服务。' }
    & docker @composeArgs build
    if ($LASTEXITCODE -ne 0) { throw '镜像构建失败，未启动服务。' }
    # 仅检查环境变量，不打开数据库，不宣称微信凭据通过远端验证。
    & docker @composeArgs run --rm --no-deps api node --input-type=module -e 'import { loadConfig } from "./server/src/config.js"; loadConfig(); console.log("生产环境变量检查通过。");'
    if ($LASTEXITCODE -ne 0) { throw '生产环境变量检查失败，未启动服务。' }
    & docker @composeArgs run --rm --no-deps nginx nginx -t
    if ($LASTEXITCODE -ne 0) { throw '证书或 nginx 配置校验失败，未启动服务。' }
    if ($CheckOnly) { Write-Output '构建与配置检查通过，尚未启动；真实登录和迁移仍需单独验收。'; return }
    & docker @composeArgs up -d --wait --wait-timeout 120
    if ($LASTEXITCODE -ne 0) { throw '服务未在期限内通过健康检查，请检查容器状态；不会自动删除数据或回滚。' }
    & docker @composeArgs ps
    if ($LASTEXITCODE -ne 0) { throw '读取容器状态失败。' }
} finally {
    $env:QIAN_ENV_FILE = $previousQianEnvFile
}
