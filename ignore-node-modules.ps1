# 让 Dropbox 忽略所有 node_modules 文件夹
# 使用 Dropbox 的特殊属性 com.dropbox.ignored

Write-Host ""
Write-Host "========================================"
Write-Host "  停止 Dropbox 同步 node_modules"
Write-Host "========================================"
Write-Host ""
Write-Host "这会让 Dropbox 忽略所有 node_modules 文件夹。"
Write-Host "node_modules 可以通过 pnpm install 重新生成。"
Write-Host ""

$rootPath = Split-Path -Parent $MyInvocation.MyCommand.Path

# 查找所有 node_modules 目录
$nodeModulesDirs = Get-ChildItem -Path $rootPath -Directory -Recurse -Filter "node_modules" -ErrorAction SilentlyContinue |
                   Where-Object { $_.FullName -notlike "*\node_modules\*\node_modules*" } |
                   Select-Object -First 10  # 只处理前 10 个顶层 node_modules

Write-Host "找到 $($nodeModulesDirs.Count) 个 node_modules 目录:"
Write-Host ""

foreach ($dir in $nodeModulesDirs) {
    $relativePath = $dir.FullName.Replace($rootPath + "\", "")
    Write-Host "  - $relativePath"
}

Write-Host ""
$confirm = Read-Host "继续设置忽略规则？(y/n)"

if ($confirm -ne 'y') {
    Write-Host "已取消。"
    exit
}

Write-Host ""
Write-Host "正在设置 Dropbox 忽略规则..."
Write-Host ""

$successCount = 0
$failCount = 0

foreach ($dir in $nodeModulesDirs) {
    try {
        # 设置 Dropbox 忽略属性
        Set-Content -Path $dir.FullName -Stream com.dropbox.ignored -Value 1 -ErrorAction Stop

        $relativePath = $dir.FullName.Replace($rootPath + "\", "")
        Write-Host "  ✓ $relativePath" -ForegroundColor Green
        $successCount++
    }
    catch {
        $relativePath = $dir.FullName.Replace($rootPath + "\", "")
        Write-Host "  ✗ $relativePath - 失败: $($_.Exception.Message)" -ForegroundColor Red
        $failCount++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "完成！" -ForegroundColor Cyan
Write-Host "成功: $successCount 个" -ForegroundColor Green
Write-Host "失败: $failCount 个" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Dropbox 现在会停止同步这些 node_modules 目录。"
Write-Host ""
Write-Host "💡 如果在其他电脑上需要这些依赖，运行："
Write-Host "   pnpm install"
Write-Host ""
Write-Host "⚠️  注意：已经上传到 Dropbox 的文件不会自动删除，"
Write-Host "   但不会再同步新的更改。"
Write-Host ""

pause
