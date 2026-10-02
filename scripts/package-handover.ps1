param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$destination = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$staging = Join-Path $destination "栖岸交接-$stamp"
if (Test-Path -LiteralPath $staging) { throw '交接目录已存在，不覆盖。' }
New-Item -ItemType Directory -Path $staging | Out-Null
# 只复制列出的源码，不复制数据库、密钥、上传文件、依赖缓存或历史运行目录。
$files = @('README.md','交付先读.md','查看界面.md','启动预览.ps1','AGENTS.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','playwright.config.ts','.gitignore','.prettierignore','.env.example')
foreach ($name in $files) {
    $source = Join-Path $projectDirectory $name
    if (Test-Path -LiteralPath $source -PathType Leaf) { Copy-Item -LiteralPath $source -Destination (Join-Path $staging $name) }
}
$folders = @('web','public','mini/shared','mini/roles','mini/tests','docs','server/src','server/tests','scripts','tests')
foreach ($name in $folders) {
    $target = Join-Path $staging $name
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $projectDirectory $name) -Force | Copy-Item -Destination $target -Recurse
}
Copy-Item -LiteralPath (Join-Path $projectDirectory 'server/API.md') -Destination (Join-Path $staging 'server/API.md')
Copy-Item -LiteralPath (Join-Path $projectDirectory 'mini/README.md') -Destination (Join-Path $staging 'mini/README.md')
New-Item -ItemType Directory -Path (Join-Path $staging 'deploy') | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectDirectory 'deploy') -File -Force | Where-Object { $_.Name -notlike '.env*' -or $_.Name -eq '.env.production.example' } | Copy-Item -Destination (Join-Path $staging 'deploy')
$zip = Join-Path $destination "栖岸交接-$stamp.zip"
# 预览快照使用游客标识，不打包原开发者的工具配置或真实应用编号。
foreach ($role in @('owner','agent')) {
    $preview = Join-Path $staging "preview-mini/$role"
    New-Item -ItemType Directory -Force -Path $preview | Out-Null
    $source = Join-Path $projectDirectory "dist/mini-$role"
    foreach ($entry in Get-ChildItem -LiteralPath $source -Force) {
        if ($entry.Name -in @('project.config.json','project.private.config.json','config.js','app')) { continue }
        Copy-Item -LiteralPath $entry.FullName -Destination $preview -Recurse
    }
    $project = @{ appid='touristappid'; projectname="qian-$role"; compileType='miniprogram'; miniprogramRoot='./'; setting=@{es6=$true; minified=$true; urlCheck=$false} }
    [IO.File]::WriteAllText((Join-Path $preview 'project.config.json'),($project | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    $config = @{role=$role;name=$(if($role -eq 'owner'){'栖岸'}else{'栖岸联卖'});mode='demo';baseURL='http://localhost:4310';privacyVersion='2026-09-09'}
    [IO.File]::WriteAllText((Join-Path $preview 'config.js'),('module.exports = '+($config | ConvertTo-Json -Compress)+';'),[Text.UTF8Encoding]::new($false))
}
# 保存视频源码与实际使用的截图，排除工具依赖和历史中间文件。
$mediaOut = Join-Path $staging 'media/handover-video'
New-Item -ItemType Directory -Force -Path (Join-Path $mediaOut 'src'),(Join-Path $mediaOut 'public') | Out-Null
foreach($name in @('package.json','package-lock.json','tsconfig.json','remotion.config.ts')) { Copy-Item -LiteralPath (Join-Path $projectDirectory "media/handover-video/$name") -Destination $mediaOut }
foreach($name in @('index.ts','Root.tsx','index.css','Portrait.tsx','DeliveryVideo.tsx')) { Copy-Item -LiteralPath (Join-Path $projectDirectory "media/handover-video/src/$name") -Destination (Join-Path $mediaOut 'src') }
Get-ChildItem -LiteralPath (Join-Path $projectDirectory 'media/handover-video/public') -Filter '*.png' | Copy-Item -Destination (Join-Path $mediaOut 'public')
Compress-Archive -LiteralPath $staging -DestinationPath $zip
Get-FileHash -LiteralPath $zip -Algorithm SHA256 | Select-Object Hash,Path
Write-Output '交接包已生成，未删除源文件；数据库和真实密钥不在交接包内。'
