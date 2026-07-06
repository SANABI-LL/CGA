#Requires -Version 5.1
<#
.SYNOPSIS
    CampusGeo 前端 UI 一键部署脚本

.DESCRIPTION
    自动完成前端文件的 S3 上传、CloudFront 缓存清除和 Git 提交。

.PARAMETER CommitMessage
    Git 提交信息（必填）

.PARAMETER SkipGit
    跳过 Git 提交步骤（可选）

.EXAMPLE
    .\deploy-ui.ps1 "UI: 修复图例颜色对比度"

.EXAMPLE
    .\deploy-ui.ps1 "UI: 调整打印排版页边距" -SkipGit
#>

param(
    [Parameter(Mandatory=$true, Position=0, HelpMessage="Git 提交信息")]
    [ValidateNotNullOrEmpty()]
    [string]$CommitMessage,

    [Parameter(Mandatory=$false)]
    [switch]$SkipGit
)

# 配置
$SOURCE_FILE = "design_handoff_campusgeo_agent\print-flow.html"
$S3_BUCKET = "campusgeo-geodata-491117467175"
$S3_KEY = "print-flow.html"
$DISTRIBUTION_ID = "E3J65QFHW23IJZ"
$AWS_PROFILE = "campusgeo-deployer"
$REGION = "us-east-1"
$PRODUCTION_URL = "https://du0vacooj41k3.cloudfront.net/print-flow.html"

# 颜色输出辅助函数
function Write-Step {
    param([string]$Message)
    Write-Host "`n$Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Warning-Custom {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "   $Message" -ForegroundColor Gray
}

# 主流程开始
Write-Host "`n================================================" -ForegroundColor Magenta
Write-Host "  CampusGeo 前端 UI 部署工具" -ForegroundColor Magenta
Write-Host "================================================`n" -ForegroundColor Magenta

# 步骤 1: 检查源文件是否存在
Write-Step "📋 步骤 1/5: 检查源文件..."

if (!(Test-Path $SOURCE_FILE)) {
    Write-Error-Custom "找不到源文件: $SOURCE_FILE"
    Write-Info "请先完成以下步骤:"
    Write-Info "1. 在 Claude Design 修改 UI"
    Write-Info "2. 下载 design_handoff_campusgeo_agent/print-flow.html"
    Write-Info "3. 将文件放入本地仓库的 design_handoff_campusgeo_agent/ 目录"
    exit 1
}

$fileSize = (Get-Item $SOURCE_FILE).Length
$fileSizeKB = [math]::Round($fileSize / 1KB, 2)
Write-Success "源文件存在: $SOURCE_FILE ($fileSizeKB KB)"

# 步骤 2: 检查 AWS CLI 配置
Write-Step "🔑 步骤 2/5: 验证 AWS 配置..."

try {
    $awsIdentity = aws sts get-caller-identity --profile $AWS_PROFILE 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "AWS CLI 配置错误"
    }
    Write-Success "AWS 配置正常 (profile: $AWS_PROFILE)"
} catch {
    Write-Error-Custom "AWS CLI 配置验证失败"
    Write-Info "请确保已配置 AWS CLI profile: $AWS_PROFILE"
    Write-Info "运行: aws configure --profile $AWS_PROFILE"
    exit 1
}

# 步骤 3: 备份当前 S3 版本（可选）
Write-Step "💾 步骤 3/5: 备份当前版本..."

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupKey = "backups/print-flow-$timestamp.html"

try {
    $backupResult = aws s3 cp "s3://$S3_BUCKET/$S3_KEY" "s3://$S3_BUCKET/$backupKey" `
        --region $REGION --profile $AWS_PROFILE 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Success "已备份当前版本: $backupKey"
    } else {
        Write-Warning-Custom "无法备份当前版本（文件可能不存在）"
        Write-Info "这是首次部署时的正常情况"
    }
} catch {
    Write-Warning-Custom "备份失败，但继续部署"
}

# 步骤 4: 上传到 S3
Write-Step "📦 步骤 4/5: 上传到 S3..."

try {
    aws s3 cp $SOURCE_FILE "s3://$S3_BUCKET/$S3_KEY" `
        --content-type "text/html" `
        --metadata-directive REPLACE `
        --region $REGION `
        --profile $AWS_PROFILE

    if ($LASTEXITCODE -ne 0) {
        throw "S3 上传失败"
    }

    Write-Success "已上传到 S3: s3://$S3_BUCKET/$S3_KEY"

    # 验证上传
    $s3FileSize = aws s3api head-object `
        --bucket $S3_BUCKET `
        --key $S3_KEY `
        --region $REGION `
        --profile $AWS_PROFILE `
        --query "ContentLength" `
        --output text

    $s3FileSizeKB = [math]::Round([int]$s3FileSize / 1KB, 2)
    Write-Info "S3 文件大小: $s3FileSizeKB KB"

} catch {
    Write-Error-Custom "S3 上传失败: $_"
    Write-Info "可能的原因:"
    Write-Info "- AWS 凭证过期"
    Write-Info "- S3 bucket 权限不足"
    Write-Info "- 网络连接问题"
    exit 1
}

# 步骤 5: 清除 CloudFront 缓存
Write-Step "🧹 步骤 5/5: 清除 CloudFront 缓存..."

try {
    $invalidationOutput = aws cloudfront create-invalidation `
        --distribution-id $DISTRIBUTION_ID `
        --paths "/$S3_KEY" `
        --profile $AWS_PROFILE `
        --output json

    if ($LASTEXITCODE -ne 0) {
        throw "CloudFront invalidation 创建失败"
    }

    $invalidation = $invalidationOutput | ConvertFrom-Json
    $invalidationId = $invalidation.Invalidation.Id
    $invalidationStatus = $invalidation.Invalidation.Status

    Write-Success "CloudFront 缓存清除请求已创建"
    Write-Info "Invalidation ID: $invalidationId"
    Write-Info "状态: $invalidationStatus"
    Write-Info "通常需要 30-60 秒完成"

} catch {
    Write-Error-Custom "CloudFront 缓存清除失败: $_"
    Write-Warning-Custom "文件已上传到 S3，但缓存未清除"
    Write-Info "可以手动清除缓存:"
    Write-Info "aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths '/$S3_KEY' --profile $AWS_PROFILE"
    exit 1
}

# 步骤 6: 提交到 Git（可选）
if (!$SkipGit) {
    Write-Step "📝 步骤 6/6: 提交到 Git..."

    # 检查是否有更改
    git diff --quiet $SOURCE_FILE
    $hasChanges = $LASTEXITCODE -ne 0

    if ($hasChanges) {
        try {
            git add $SOURCE_FILE
            git commit -m $CommitMessage

            if ($LASTEXITCODE -ne 0) {
                throw "Git commit 失败"
            }

            Write-Success "已提交到本地仓库: $CommitMessage"

            # 推送到远程
            Write-Info "正在推送到远程仓库..."
            git push

            if ($LASTEXITCODE -eq 0) {
                Write-Success "已推送到远程仓库"
            } else {
                Write-Warning-Custom "推送失败，请手动执行: git push"
            }

        } catch {
            Write-Error-Custom "Git 操作失败: $_"
            Write-Info "文件已部署到 S3，但未提交到 Git"
            Write-Info "请手动提交:"
            Write-Info "git add $SOURCE_FILE"
            Write-Info "git commit -m '$CommitMessage'"
            Write-Info "git push"
            exit 1
        }
    } else {
        Write-Warning-Custom "文件没有变化，跳过 Git 提交"
    }
} else {
    Write-Warning-Custom "已跳过 Git 提交步骤（-SkipGit 参数）"
}

# 部署完成总结
Write-Host "`n================================================" -ForegroundColor Magenta
Write-Host "  🎉 部署完成！" -ForegroundColor Green
Write-Host "================================================`n" -ForegroundColor Magenta

Write-Info "生产环境 URL:"
Write-Host "   $PRODUCTION_URL" -ForegroundColor White
Write-Info ""
Write-Info "验证步骤:"
Write-Info "1. 等待 30-60 秒让 CDN 刷新缓存"
Write-Info "2. 在浏览器中打开上述 URL"
Write-Info "3. 强制刷新: Ctrl + Shift + R (Chrome/Edge)"
Write-Info "4. 检查修改是否生效"
Write-Info ""
Write-Info "如果看不到变化:"
Write-Info "- 检查 Invalidation 状态: aws cloudfront get-invalidation --distribution-id $DISTRIBUTION_ID --id $invalidationId --profile $AWS_PROFILE"
Write-Info "- 使用无痕模式打开浏览器"
Write-Info "- 清除浏览器本地缓存"

# 可选：直接打开浏览器
Write-Host "`n是否在浏览器中打开生产 URL？(Y/N): " -NoNewline -ForegroundColor Yellow
$openBrowser = Read-Host

if ($openBrowser -eq "Y" -or $openBrowser -eq "y") {
    Start-Process $PRODUCTION_URL
    Write-Success "已在默认浏览器中打开"
}

Write-Host "`n✨ 部署脚本执行完毕`n" -ForegroundColor Magenta
