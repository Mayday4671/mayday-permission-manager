<# 只停止本启动脚本记录且命令行确实属于本项目的进程；不按端口或进程名称批量结束进程。 #>
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskRecord = Join-Path $taskRoot '.local/processes.json'
if (-not (Test-Path -LiteralPath $taskRecord)) { Write-Host '没有发现本地开发进程记录。Docker 服务请使用 docker compose stop。'; exit 0 }
$taskProcesses = Get-Content -LiteralPath $taskRecord -Raw | ConvertFrom-Json
if ($taskProcesses.root -ne $taskRoot) { throw '进程记录与当前项目目录不一致，已停止操作。' }
foreach ($taskId in @($taskProcesses.backend, $taskProcesses.frontend)) {
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskId"
    if ($taskProcess -and $taskProcess.CommandLine -and $taskProcess.CommandLine.Contains($taskRoot)) {
        Stop-Process -Id $taskId
    }
}
Remove-Item -LiteralPath $taskRecord
Write-Host '前后端开发服务已停止。MySQL 数据与容器均保留。'
