<#!
  本地开发启动器（Windows PowerShell 7 / Windows PowerShell 5.1）。
  自动启动隔离 MySQL，构建后端并在后台运行两个开发服务；不修改系统 PATH，不关闭占用端口的其他程序。
  Java 可通过 -JavaHome 显式指定；前后端日志与进程记录位于项目 .local 目录。
#>
param([string]$JavaHome = $env:JAVA_HOME, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskRuntime = Join-Path $taskRoot '.local'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
if (-not (Test-Path (Join-Path $taskRoot '.env'))) {
    Copy-Item -LiteralPath (Join-Path $taskRoot '.env.example') -Destination (Join-Path $taskRoot '.env')
}
# 只解析本项目的简单 KEY=VALUE 配置，不执行 .env 内的任何内容。
$taskConfig = @{}
Get-Content -LiteralPath (Join-Path $taskRoot '.env') | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { $taskConfig[$matches[1]] = $matches[2].Trim() }
}
if ($JavaHome) { $env:JAVA_HOME = $JavaHome; $taskJava = Join-Path $JavaHome 'bin/java.exe' }
else { $taskJava = (Get-Command java -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $taskJava)) { throw '请安装 Java 21，或通过 -JavaHome 指定 JDK 目录。' }
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskApiPort = if ($taskConfig.API_PORT) { [int]$taskConfig.API_PORT } else { 18080 }
$taskWebPort = if ($taskConfig.WEB_PORT) { [int]$taskConfig.WEB_PORT } else { 15173 }
foreach ($taskPort in @($taskApiPort, $taskWebPort)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $taskPort -ErrorAction SilentlyContinue) {
        throw "端口 $taskPort 已被占用。请先关闭该端口上的 Mayday 实例，或修改 .env 端口配置。"
    }
}
Push-Location $taskRoot
try {
    & docker compose up -d --wait mysql
    if ($LASTEXITCODE -ne 0) { throw 'MySQL 启动失败，请检查 Docker Desktop 与端口设置。' }
    if (-not $SkipBuild) {
        Push-Location (Join-Path $taskRoot 'backend')
        try { & .\mvnw.cmd -B package; if ($LASTEXITCODE -ne 0) { throw '后端构建失败。' } } finally { Pop-Location }
    }
    Push-Location (Join-Path $taskRoot 'frontend')
    try { if (-not (Test-Path 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败。' } } } finally { Pop-Location }
    $env:DB_URL = "jdbc:mysql://127.0.0.1:$($taskConfig.DB_PORT)/$($taskConfig.MYSQL_DATABASE)?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai"
    $env:DB_USERNAME = $taskConfig.MYSQL_USER
    $env:DB_PASSWORD = $taskConfig.MYSQL_PASSWORD
    $env:ADMIN_PASSWORD = $taskConfig.ADMIN_PASSWORD
    $env:SERVER_PORT = [string]$taskApiPort
    $env:VITE_API_TARGET = "http://127.0.0.1:$taskApiPort"
    $taskJar = Join-Path $taskRoot 'backend/mayday-application/target/mayday-application-1.0.0.jar'
    # Windows 会锁定正在运行的 jar；运行副本让后续 Maven 构建仍可正常替换 target 产物。
    $taskRunJar = Join-Path $taskRuntime 'mayday-runtime.jar'
    Copy-Item -LiteralPath $taskJar -Destination $taskRunJar -Force
    $taskVite = Join-Path $taskRoot 'frontend/node_modules/vite/bin/vite.js'
    $taskBackend = Start-Process -FilePath $taskJava -ArgumentList @('-jar', ('"' + $taskRunJar + '"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRuntime 'backend.log') -RedirectStandardError (Join-Path $taskRuntime 'backend.error.log')
    $taskFrontend = Start-Process -FilePath $taskNode -ArgumentList @(('"' + $taskVite + '"'), '--host', '127.0.0.1', '--port', [string]$taskWebPort) -WorkingDirectory (Join-Path $taskRoot 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRuntime 'frontend.log') -RedirectStandardError (Join-Path $taskRuntime 'frontend.error.log')
    @{ backend = $taskBackend.Id; frontend = $taskFrontend.Id; root = $taskRoot } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRuntime 'processes.json')
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 45; $taskAttempt++) {
        try { $taskHealth = Invoke-RestMethod "http://127.0.0.1:$taskApiPort/actuator/health"; if ($taskHealth.status -eq 'UP') { $taskReady = $true; break } } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $taskReady) { throw '服务未按时启动，请查看 .local/backend.log。已启动的进程可用 scripts/stop.ps1 关闭。' }
    Write-Host "前台门户：http://127.0.0.1:$taskWebPort/"
    Write-Host "后台登录：http://127.0.0.1:$taskWebPort/login"
    Write-Host '管理员账号：admin；密码为 .env 中的 ADMIN_PASSWORD。'
} finally { Pop-Location }
