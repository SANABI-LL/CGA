# CampusGeo UI 部署快速入门

## 🚀 一键部署（3 步）

### 1. 在 Claude Design 修改 UI
```
你: "把地图图例背景色改为半透明暖灰"
Claude Design: [修改 ui_kits/campusgeo/print-flow.html]
你: [点击下载 design_handoff_campusgeo_agent/print-flow.html]
```

### 2. 移动文件到本地仓库
```powershell
# PowerShell
mv ~\Downloads\print-flow.html design_handoff_campusgeo_agent\print-flow.html

# 或者手动拖拽文件到 design_handoff_campusgeo_agent\ 文件夹
```

### 3. 运行部署脚本
```powershell
.\deploy-ui.ps1 "UI: 修复图例颜色对比度"
```

**完成！** 🎉

脚本会自动：
- ✅ 上传到 S3
- ✅ 清除 CloudFront 缓存
- ✅ 提交到 Git
- ✅ 推送到远程仓库

---

## 📋 验证部署

等待 30-60 秒后：

1. 打开 https://du0vacooj41k3.cloudfront.net/print-flow.html
2. 强制刷新: `Ctrl + Shift + R`
3. 检查修改是否生效

---

## 🛠️ 常用命令

### 只部署不提交 Git
```powershell
.\deploy-ui.ps1 "UI: 测试版本" -SkipGit
```

### 查看部署状态
```powershell
# 检查 S3 文件
aws s3 ls s3://campusgeo-geodata-491117467175/print-flow.html --human-readable --profile campusgeo-deployer

# 检查 CloudFront invalidations
aws cloudfront list-invalidations --distribution-id E3J65QFHW23IJZ --profile campusgeo-deployer
```

### 手动清除缓存（如果脚本失败）
```powershell
aws cloudfront create-invalidation `
  --distribution-id E3J65QFHW23IJZ `
  --paths "/print-flow.html" `
  --profile campusgeo-deployer
```

---

## ⚠️ 首次使用

### 创建 handoff 目录
```powershell
mkdir design_handoff_campusgeo_agent
```

### 配置 AWS CLI
```powershell
aws configure --profile campusgeo-deployer

# 输入：
# AWS Access Key ID: [你的 Key]
# AWS Secret Access Key: [你的 Secret]
# Default region name: us-east-1
# Default output format: json
```

### 允许脚本执行（如果遇到权限错误）
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## 📚 更多信息

- **详细使用说明**: 见 `deploy-ui.README.md`
- **完整部署流程**: 见 `Guideline.html`（在浏览器中打开）
- **问题排查**: 见 `deploy-ui.README.md` 的"常见问题"部分

---

## 🎯 工作流程总结

```
Claude Design (网页)    →  下载文件  →  本地仓库  →  运行脚本  →  生产环境
    修改 UI                            移动文件       一键部署      验证结果
```

**重要**: Claude Design 和 Claude Code 是两个独立的工具，不能互相通信。文件传递需要手动下载和移动。

---

**最后更新**: 2026-07-06
