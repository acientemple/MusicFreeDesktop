/**
 * Windows 原地更新用的 PowerShell 脚本。
 *
 * 以字符串形式内联而不是单独放 .ps1 文件：打包后资源定位不可靠，
 * 而且这个脚本只在 Windows 便携版安装时用一次。
 *
 * 用系统自带的 powershell.exe 而不是应用自己，是因为运行中的
 * MusicFree.exe 被 Windows 锁定，无法被替换 —— helper 必须是别的可执行文件。
 */
export const installScript = `
param(
    [Parameter(Mandatory=$true)][int]$AppPid,
    [Parameter(Mandatory=$true)][string]$Target,
    [Parameter(Mandatory=$true)][string]$Staging,
    [Parameter(Mandatory=$true)][string]$Log,
    [Parameter(Mandatory=$true)][string]$Result
)

$ErrorActionPreference = "Continue"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

function Write-Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    try { Add-Content -LiteralPath $Log -Value $line -Encoding UTF8 } catch { }
}

function Write-Result([string]$msg) {
    try { Set-Content -LiteralPath $Result -Value $msg -Encoding UTF8 } catch { }
}

function Fail([string]$reason, [int]$code) {
    Write-Log ("FATAL: " + $reason)
    Write-Result ("failed: " + $reason)
    exit $code
}

Write-Log ("installer started, target=" + $Target)

# 1. 等待主进程退出（它锁着 exe 和已加载的 dll）
$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
    $running = Get-Process -Id $AppPid -ErrorAction SilentlyContinue
    if (-not $running) { break }
    Start-Sleep -Milliseconds 500
}
if (Get-Process -Id $AppPid -ErrorAction SilentlyContinue) {
    Fail ("app process " + $AppPid + " still running after 120s") 2
}
Write-Log "app process exited"
Start-Sleep -Seconds 3

# 2. 旧的 app / res 改名保留（回滚点），不直接删
$resourcesDir = Join-Path $Target "resources"
$backups = @()
foreach ($name in @("app", "res")) {
    $src = Join-Path $resourcesDir $name
    if (Test-Path -LiteralPath $src) {
        $bak = $src + ".bak-" + $stamp
        try {
            Rename-Item -LiteralPath $src -NewName (Split-Path -Leaf $bak) -Force
            $backups += ,@($src, $bak)
            Write-Log ("renamed " + $src + " -> " + $bak)
        } catch {
            Write-Log ("WARN: cannot rename " + $src + " : " + $_.Exception.Message)
        }
    }
}

# 3. 拷入新版本（robocopy 退出码 0-7 都算成功，>=8 才是失败）
# robocopy 没有 /H 参数，带上会直接报 Invalid Parameter 并以 16 退出；
# 隐藏/系统属性文件 robocopy 本来就会复制，无需显式指定。
$output = & robocopy $Staging $Target /E /IS /R:3 /W:2 /NFL /NDL /NJH /NJS /NP 2>&1
$code = $LASTEXITCODE
foreach ($line in $output) { Write-Log ("robocopy: " + $line) }
Write-Log ("robocopy exit code " + $code)
if ($code -ge 8) {
    foreach ($b in $backups) {
        if (Test-Path -LiteralPath $b[1]) {
            if (Test-Path -LiteralPath $b[0]) {
                Remove-Item -LiteralPath $b[0] -Recurse -Force -ErrorAction SilentlyContinue
            }
            Rename-Item -LiteralPath $b[1] -NewName (Split-Path -Leaf $b[0]) -Force -ErrorAction SilentlyContinue
            Write-Log ("rolled back " + $b[0])
        }
    }
    Fail ("robocopy failed with code " + $code) 3
}

# 4. 清理更早的回滚点（每个 67MB，留着会一直涨）
foreach ($name in @("app", "res")) {
    $keep = $name + ".bak-" + $stamp
    Get-ChildItem -LiteralPath $resourcesDir -Directory -Filter ($name + ".bak-*") -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne $keep } |
        ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            Write-Log ("removed stale backup " + $_.FullName)
        }
}

# 5. 重启
$exe = Join-Path $Target "MusicFree.exe"
if (Test-Path -LiteralPath $exe) {
    Start-Process -FilePath $exe -WorkingDirectory $Target
    Write-Log ("relaunched " + $exe)
} else {
    Write-Log ("WARN: " + $exe + " not found, skip relaunch")
}

Write-Log "install finished"
Write-Result "success"
exit 0
`;
