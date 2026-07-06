# 前端 UI 一键部署脚本使用指南

## 快速开始

### 完整流程（3 步）

```powershell
# 1. 从 Claude Design 下载文件后，移动到仓库
mv ~/Downloads/print-flow.html design_handoff_campusgeo_agent/print-flow.html

# 2. 运行部署脚本
.\deploy-ui.ps1 "UI: 修复图例颜色对比度"

# 3. 等待 30-60 秒，在浏览器中验证
# https://du0vacooj41k3.cloudfront.net/print-flow.html
```

---

## 脚本功能

`deploy-ui.ps1` 自动完成以下 6 个步骤：

1. ✅ 检查源文件是否存在
2. 🔑 验证 AWS CLI 配置
3. 💾 备份 S3 当前版本
4. 📦 上传新版本到 S3
5. 🧹 清除 CloudFront 缓存
6. 📝 提交到 Git 并推送

---

## 使用方法

### 基本用法

```powershell
.\deploy-ui.ps1 "提交信息"
```

**示例**：
```powershell
.\deploy-ui.ps1 "UI: 修复地图图例颜色对比度"
.\deploy-ui.ps1 "UI: 调整打印排版页边距"
.\deploy-ui.ps1 "UI: 优化 Agent 推理面板动画"
```

### 跳过 Git 提交

如果只想部署到 S3/CloudFront，但暂时不提交 Git：

```powershell
.\deploy-ui.ps1 "UI: 测试版本" -SkipGit
```

### 查看帮助

```powershell
Get-Help .\deploy-ui.ps1 -Full
```

---

## 前置条件

### 1. 文件准备

确保文件已放在正确位置：
```
design_handoff_campusgeo_agent/print-flow.html
```

**首次使用需要创建目录**：
```powershell
mkdir design_handoff_campusgeo_agent
```

### 2. AWS CLI 配置

确保已配置 `campusgeo-deployer` profile：
```powershell
# 检查配置
aws sts get-caller-identity --profile campusgeo-deployer

# 如果未配置，运行
aws configure --profile campusgeo-deployer
```

需要的权限：
- S3: `s3:PutObject`, `s3:GetObject`
- CloudFront: `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation`

### 3. Git 仓库

确保在仓库根目录运行脚本，且 Git 工作目录干净（无未提交的其他更改）。

---

## 输出示例

```
================================================
  CampusGeo 前端 UI 部署工具
================================================

📋 步骤 1/5: 检查源文件...
✅ 源文件存在: design_handoff_campusgeo_agent\print-flow.html (45.73 KB)

🔑 步骤 2/5: 验证 AWS 配置...
✅ AWS 配置正常 (profile: campusgeo-deployer)

💾 步骤 3/5: 备份当前版本...
✅ 已备份当前版本: backups/print-flow-20260706-143522.html

📦 步骤 4/5: 上传到 S3...
✅ 已上传到 S3: s3://campusgeo-geodata-491117467175/print-flow.html
   S3 文件大小: 45.73 KB

🧹 步骤 5/5: 清除 CloudFront 缓存...
✅ CloudFront 缓存清除请求已创建
   Invalidation ID: I2ABCDEFG123
   状态: InProgress
   通常需要 30-60 秒完成

📝 步骤 6/6: 提交到 Git...
✅ 已提交到本地仓库: UI: 修复图例颜色对比度
   正在推送到远程仓库...
✅ 已推送到远程仓库

================================================
  🎉 部署完成！
================================================

   生产环境 URL:
   https://du0vacooj41k3.cloudfront.net/print-flow.html

   验证步骤:
   1. 等待 30-60 秒让 CDN 刷新缓存
   2. 在浏览器中打开上述 URL
   3. 强制刷新: Ctrl + Shift + R (Chrome/Edge)
   4. 检查修改是否生效

是否在浏览器中打开生产 URL？(Y/N):
```

---

## 常见问题

### Q: 脚本报错 "找不到源文件"

**A**: 确保文件路径正确：
```powershell
# 检查文件是否存在
ls design_handoff_campusgeo_agent\print-flow.html

# 如果不存在，从 Claude Design 下载并移动
mv ~/Downloads/print-flow.html design_handoff_campusgeo_agent\
```

### Q: AWS CLI 报错 "配置验证失败"

**A**: 重新配置 AWS profile：
```powershell
aws configure --profile campusgeo-deployer

# 输入：
# AWS Access Key ID: [你的 Key]
# AWS Secret Access Key: [你的 Secret]
# Default region name: us-east-1
# Default output format: json
```

### Q: CloudFront 缓存清除失败

**A**: 手动清除：
```powershell
aws cloudfront create-invalidation `
  --distribution-id E3J65QFHW23IJZ `
  --paths "/print-flow.html" `
  --profile campusgeo-deployer
```

### Q: Git 推送失败

**A**: 手动推送：
```bash
git push
```

如果被拒绝，可能需要先拉取远程更改：
```bash
git pull --rebase
git push
```

### Q: 浏览器看不到变化

**A**: 尝试以下步骤：
1. 等待 1-2 分钟（CloudFront 全球传播需要时间）
2. 强制刷新: `Ctrl + Shift + R` (Windows) 或 `Cmd + Shift + R` (Mac)
3. 使用无痕模式打开浏览器
4. 清除浏览器缓存
5. 检查 Invalidation 状态：
   ```powershell
   aws cloudfront list-invalidations `
     --distribution-id E3J65QFHW23IJZ `
     --profile campusgeo-deployer
   ```

---

## 手动执行步骤（如果脚本不可用）

如果无法运行 PowerShell 脚本，可以手动执行：

```powershell
# 1. 上传到 S3
aws s3 cp design_handoff_campusgeo_agent\print-flow.html `
  s3://campusgeo-geodata-491117467175/print-flow.html `
  --content-type "text/html" --profile campusgeo-deployer

# 2. 清除 CloudFront 缓存
aws cloudfront create-invalidation `
  --distribution-id E3J65QFHW23IJZ `
  --paths "/print-flow.html" --profile campusgeo-deployer

# 3. 提交 Git
git add design_handoff_campusgeo_agent\print-flow.html
git commit -m "UI: 你的提交信息"
git push
```

---

## 脚本配置（高级）

如果需要修改配置（如 S3 bucket、CloudFront ID），编辑脚本开头的配置部分：

```powershell
# 配置
$SOURCE_FILE = "design_handoff_campusgeo_agent\print-flow.html"
$S3_BUCKET = "campusgeo-geodata-491117467175"
$S3_KEY = "print-flow.html"
$DISTRIBUTION_ID = "E3J65QFHW23IJZ"
$AWS_PROFILE = "campusgeo-deployer"
$REGION = "us-east-1"
```

---

## 相关文档

- **完整部署流程**: 见 `Guideline.html`（在浏览器中打开查看可视化文档）
- **项目记忆**: `.claude/projects/.../memory/project_deployment_workflow.md`
- **AWS 资源**: 见 `QUICKSTART.md` 或 `PROJECT_STATUS.md`

---

## 技术细节

- **PowerShell 版本**: 需要 5.1 或更高
- **AWS CLI**: 需要 v2.x
- **执行策略**: 如果遇到 "无法加载脚本" 错误，运行：
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

---

**最后更新**: 2026-07-06  
**脚本版本**: 1.0.0  
**维护者**: CampusGeo 项目组
