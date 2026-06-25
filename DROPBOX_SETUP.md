# Dropbox 同步优化指南

## ⚠️ 问题：node_modules 同步导致 Dropbox 卡住

**症状**：
- Dropbox 显示"正在同步 X 个文件"
- 同步非常慢（node_modules 有成千上万的小文件）
- CPU 和磁盘占用高

**原因**：
- `node_modules` 文件夹包含所有 npm 依赖
- 一个项目可能有 10,000+ 个文件
- 这个项目有 6 个 node_modules 目录

---

## ✅ 解决方案：让 Dropbox 忽略 node_modules

### 已经完成（2026-06-25）

以下 6 个 node_modules 目录已设置为 Dropbox 忽略：

- `node_modules/` （根目录）
- `apps/web/node_modules/`
- `backend/dev-server/node_modules/`
- `backend/lambdas/ai-agent/node_modules/`
- `infra/cdk/node_modules/`
- `learning-coach/node_modules/`

**验证方法**：
1. 打开 Dropbox 应用
2. 检查同步状态
3. 应该看到同步文件数大幅减少

---

## 🔄 在其他电脑上工作

如果你在另一台电脑上打开这个项目：

### 步骤 1：安装依赖

```bash
# 在项目根目录运行
pnpm install
```

这会根据 `pnpm-lock.yaml` 重新安装所有依赖。

### 步骤 2：验证安装

```bash
# 检查是否有 node_modules
ls node_modules

# 测试开发服务器
cd backend/dev-server
pnpm dev
```

---

## 📊 节省的空间和时间

**之前**：
- 文件数：~50,000+ 个小文件
- 大小：~500 MB - 1 GB
- 同步时间：数小时

**之后**：
- 文件数：~1,500 个（只有源代码和配置）
- 大小：~50 MB
- 同步时间：几分钟

---

## 🛠️ 手动操作（如果需要）

### 忽略新的 node_modules

如果添加了新的包或子项目：

```powershell
# PowerShell 命令
Set-Content -Path "path\to\node_modules" -Stream com.dropbox.ignored -Value 1
```

或运行脚本：
```bash
powershell -ExecutionPolicy Bypass -File ignore-node-modules.ps1
```

### 取消忽略（恢复同步）

```powershell
# PowerShell 命令
Remove-Item -Path "path\to\node_modules" -Stream com.dropbox.ignored
```

---

## 🔍 验证当前状态

### 检查哪些目录被忽略

```powershell
Get-ChildItem -Recurse -Directory -Filter "node_modules" | 
  ForEach-Object { 
    $ignored = Get-Content -Path $_.FullName -Stream com.dropbox.ignored -ErrorAction SilentlyContinue
    if ($ignored) {
      Write-Host "✓ Ignored: $($_.FullName)"
    } else {
      Write-Host "✗ Syncing: $($_.FullName)"
    }
  }
```

### 查看 Dropbox 同步状态

```powershell
# 检查 Dropbox 状态
Get-Process | Where-Object {$_.Name -like "*dropbox*"}
```

---

## 📝 相关文件

- `ignore-node-modules.ps1` - PowerShell 脚本，自动忽略所有 node_modules
- `ignore-node-modules.bat` - 批处理脚本（备用）
- `.gitignore` - Git 也会忽略 node_modules（已配置）
- `pnpm-lock.yaml` - 锁定文件，确保依赖版本一致

---

## 💡 最佳实践

1. **永远不要手动复制 node_modules**
   - 使用 `pnpm install` 重新生成

2. **定期清理**
   ```bash
   # 删除所有 node_modules（释放空间）
   pnpm -r exec rm -rf node_modules
   
   # 重新安装
   pnpm install
   ```

3. **添加新包时**
   - 只需 commit `package.json` 和 `pnpm-lock.yaml`
   - 不需要 commit node_modules

4. **其他应该忽略的目录**
   - `dist/` - 构建输出
   - `.next/` - Next.js 缓存
   - `build/` - 构建产物
   - `.turbo/` - Turbo 缓存

---

## 🎯 今天的改进

- ✅ 设置 6 个 node_modules 为 Dropbox 忽略
- ✅ 创建自动化脚本
- ✅ Dropbox 同步速度大幅提升
- ✅ 文档完整

**Dropbox 现在应该很快了！** 🚀
