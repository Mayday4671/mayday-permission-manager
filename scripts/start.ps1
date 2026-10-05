<#
  Windows 一键开发启动器，兼容 PowerShell 5.1 / 7。
  Node 辅助入口读取完整 .env、核对本机 Docker、隔离 Java 环境并验证前后端健康。
  保留 -JavaHome / -SkipBuild；不修改系统 PATH，不按端口停止其他程序，后台窗口隐藏。
#>
param([string]$JavaHome = $env:JAVA_HOME, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskArguments = @((Join-Path $PSScriptRoot 'development-runtime.mjs'), 'start')
if ($JavaHome) { $taskArguments += @('--java-home', $JavaHome) }
if ($SkipBuild) { $taskArguments += '--skip-build' }
# 参数数组保留含空格的路径，.env 内容不会进入 PowerShell 表达式或命令字符串。
& $taskNode @taskArguments
if ($LASTEXITCODE -ne 0) { throw '开发服务未就绪，请查看上方指向的本次日志和 .local/processes.json。' }
