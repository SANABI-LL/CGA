---
name: campusgeo-update-data
description: CampusGeo 数据更新标准循环——校验新导出的 GeoJSON、覆盖上传 S3、触发 Daily Digest、验证提醒与查询。当用户说导出了新的 GeoJSON、要更新图层数据、要看 digest 是否检测到变化时使用。
---

# CampusGeo 数据更新循环

数据流:`用户从 ArcGIS 导出 GeoJSON → 校验 → 覆盖上传 S3 同名键 → digest 管道 diff → 页面弹条提醒用户`。
Daily Digest 监视**固定键名**(layers/ 下 27 个),换新文件名不会被检测,必须原位覆盖。

## 第 1 步:上传前校验(每次必做,直接对比线上现役文件)

下载 S3 现役版,与新文件比对,四项全绿才继续:

1. **要素数变化符合预期**(比如 +3);范围倒退(5488→539)= 拿错了导出范围,中止
2. **字段集完全一致**——字段名漂移会让 agent 工具静默失效(教训:Common_Nam→CommonName 曾使"查枫树"恒 0)
3. **ID 稳定性(diff 的命根)**:旧要素的 OBJECTID/TreeID 必须 100% 保留;若导出工具重编号,digest 会误报全量增删,中止并改用稳定 ID 字段
4. **新增行属性抽查**:把新要素的非空属性打出来给用户确认——"没有数据"不是系统 bug(教训:3 棵新树只有 TreeNotes,树种/冠幅是真的没填;还有把 "Good" 填进 AgeClass 列的笔误)

## 第 2 步:上传

```bash
aws s3 cp <本地文件> s3://campusgeo-geodata-491117467175/layers/<同名>.geojson --content-type "application/json"
```

utility 系列有覆盖保护惯例:先 list 目标键,已存在非预期文件则中止。

## 第 3 步:触发 digest(不必等凌晨 2 点)

```bash
printf '{"source":"aws.events"}' > event.json
aws lambda invoke --function-name campusgeo-query --payload fileb://event.json --cli-read-timeout 180 out.json
```

返回 `{ok, baseline, items}`;正常应出现对应图层的 item(如 "Campus Trees: 3 added")。
EventBridge 规则 `campusgeo-daily-digest` 每日 02:00 CT 也会自动跑同一逻辑。

## 第 4 步:验证

1. `curl https://du0vacooj41k3.cloudfront.net/digest/latest.json` — items 如实反映本次变更
2. 相关 agent 查询走一遍(如 "how many trees" 应报新总数;"trees planted in fall 2025" 走 notes 过滤)
3. 页面 Ctrl+Shift+R:约 1.4 秒后右上弹条显示变更;铃铛面板日期为今天

## 机制与坑

- digest 实现:`backend/lambdas/ai-agent/digest.ts` — 27 层 ETag 指纹(未变化零下载)→ 要素 ID 集合识别新增/删除 → 按名称字段(树:CommonName→ScientName→TreeNotes 回退)汇总描述 → 写 `digest/latest.json` + `digest/state.json`
- **写权限来自桶策略**(AllowDigestWriteByQueryLambda,仅 digest/* 前缀)——Lambda 角色本身无 s3:PutObject,别试图在 IAM 侧修
- 前端读取优先级:digest/latest.json → 脚本示例(baseline 或读取失败时);items 空 = 显示"今日无更新"
- **模拟测试法**(不动真数据验证 diff):下载 digest/state.json,删掉某层几个 ID + 相应减 count + 破坏 etag,回传后触发 → digest 应报对应新增
- 首次运行只建基准(baseline: true, 无 items),第二次起出真 diff
- 数据被 agent 工具消费时的字段约定:树 CommonName/AgeClass/Condition/DBH1/CanRadius/TreeNotes;建筑 DISCRIPT1/RI_23/FCI_23 等——改 schema 前先 grep tools/campus/ 里的字段引用
