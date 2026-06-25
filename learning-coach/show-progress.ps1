# CampusGeo Learning Coach - Progress Viewer
# 支持中文/英文显示

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  CampusGeo Learning Coach" -ForegroundColor Cyan
Write-Host "  进度追踪器 Progress Tracker" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$progressPath = Join-Path $PSScriptRoot "data\progress.json"

if (-not (Test-Path $progressPath)) {
    Write-Host "⚠️  进度文件未找到 Progress file not found" -ForegroundColor Yellow
    Write-Host "路径 Path: $progressPath"
    pause
    exit
}

$progress = Get-Content $progressPath -Raw -Encoding UTF8 | ConvertFrom-Json

# 当前周信息
$currentWeek = $progress.currentWeek
$weekData = $progress.weeklyProgress."week$currentWeek"

Write-Host "📅 开始日期 Start Date: " -NoNewline
Write-Host $progress.startDate -ForegroundColor Green

Write-Host "📊 当前周次 Current Week: " -NoNewline
Write-Host "Week $currentWeek" -ForegroundColor Green

Write-Host "🔥 连续天数 Streak Days: " -NoNewline
Write-Host "$($progress.streakDays) 天 days" -ForegroundColor Green

Write-Host "📅 最后活跃 Last Active: " -NoNewline
Write-Host $progress.lastActiveDate -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Week $currentWeek 状态 Status" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "状态 Status: " -NoNewline
switch ($weekData.status) {
    "not_started" { Write-Host "未开始 Not Started" -ForegroundColor Gray }
    "in_progress" { Write-Host "进行中 In Progress" -ForegroundColor Yellow }
    "completed" { Write-Host "已完成 Completed" -ForegroundColor Green }
}

Write-Host "工作时间 Hours Spent: " -NoNewline
Write-Host "$($weekData.hoursSpent) 小时 hours" -ForegroundColor Green

Write-Host "完成目标 Completed Objectives: " -NoNewline
Write-Host "$($weekData.completedObjectives.Count) 个 items" -ForegroundColor Green

Write-Host "实践项目 Practice: " -NoNewline
if ($weekData.practiceCompleted) {
    Write-Host "✓ 已完成 Completed" -ForegroundColor Green
} else {
    Write-Host "⬜ 未完成 Not Completed" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  完成的目标 Completed Objectives" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$index = 1
foreach ($obj in $weekData.completedObjectives) {
    Write-Host "  $index. " -NoNewline -ForegroundColor Gray
    Write-Host $obj -ForegroundColor White
    $index++
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  学习笔记 Learning Notes" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($weekData.notes -and $weekData.notes.Count -gt 0) {
    foreach ($note in $weekData.notes) {
        Write-Host "📝 日期 Date: " -NoNewline
        Write-Host $note.date -ForegroundColor Green

        Write-Host "内容 Content:" -ForegroundColor Yellow
        Write-Host $note.content -ForegroundColor White
        Write-Host ""

        if ($note.learnings) {
            Write-Host "收获 Learnings:" -ForegroundColor Yellow
            Write-Host $note.learnings -ForegroundColor White
            Write-Host ""
        }
    }
} else {
    Write-Host "  (暂无笔记 No notes yet)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  可用命令 Available Commands" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  show-progress.bat" -NoNewline -ForegroundColor Green
Write-Host "     - 查看进度 View progress (简化版 simple)"
Write-Host ""
Write-Host "  show-progress.ps1" -NoNewline -ForegroundColor Green
Write-Host "     - 查看进度 View progress (彩色版 colored)"
Write-Host ""
Write-Host "  npm run track:stats" -NoNewline -ForegroundColor Green
Write-Host "   - 详细统计 Detailed stats"
Write-Host ""
Write-Host "  npm run track:log" -NoNewline -ForegroundColor Green
Write-Host "     - 记录今日 Log today's work"
Write-Host ""
Write-Host "  npm run track:remind" -NoNewline -ForegroundColor Green
Write-Host "   - 检查提醒 Check reminders"
Write-Host ""

Write-Host ""
pause
