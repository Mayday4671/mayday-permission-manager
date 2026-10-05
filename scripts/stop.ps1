<#
  只停止进程记录指向且路径、类型及创建时间核对一致的本项目 Java/Vite。
  不按端口或名称批量结束程序；失败保留记录，MySQL 与用户文件始终保持不变。
#>
$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node -ErrorAction Stop).Source
& $taskNode (Join-Path $PSScriptRoot 'development-runtime.mjs') stop
if ($LASTEXITCODE -ne 0) { throw '停止失败，已保留原进程记录；请按日志核对进程身份。' }
