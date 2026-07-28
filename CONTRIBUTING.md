# 贡献指南

感谢你参与“战术罗盘”的开发。这个项目涉及视频解码、计算机视觉、轨迹关联和数据可视化。为了让问题可以复现、修改可以验证，请遵循下面的协作方式。

## 开始之前

1. 阅读 [README](README.md) 和 [架构说明](docs/ARCHITECTURE.md)。
2. 搜索现有 Issue，避免重复提交。
3. 大型功能、识别口径变化或数据格式变更应先创建 Issue 讨论。
4. 不要向仓库提交比赛视频、英雄素材、分析结果或个人绝对路径。

## 开发环境

### 本地视频分析器

```bash
python -m venv .venv
python -m pip install -r requirements-local.txt
```

激活虚拟环境后运行：

```bash
python local_app.py
```

### 可选 Web 原型

```bash
npm ci
npm run dev
```

本地视频分析器与 Web 原型是两个入口。修改前请确认你的变更属于哪一层。

## 推荐分支命名

```text
feature/short-description
fix/short-description
docs/short-description
perf/short-description
```

请让一次 Pull Request 只解决一个明确问题。

## 提交信息

推荐使用简洁的命令式提交信息：

```text
feat: add per-video calibration workflow
fix: avoid duplicate red hero markers
perf: reduce repeated frame seeking
docs: document probability schema
```

## 编码约定

### Python

- 使用 Python 3.10+ 可用的语法。
- 新函数应有明确名称；复杂跟踪逻辑应添加解释“为什么”的注释。
- 路径通过 `pathlib.Path` 处理。
- 不要在源码中写入用户绝对路径、令牌或素材文件名。
- 后台任务必须通过 `update_job` 暴露可理解的进度和错误。

### 浏览器端

- 本地 UI 保持无构建步骤，继续使用原生 HTML、CSS 和 JavaScript。
- 用户输入写回 DOM 前必须转义。
- 批量分析状态应归属于具体视频，避免在对局之间复用校准数据。
- 区域分类规则变更时必须同步更新文档和导出格式说明。

### 计算机视觉

- 新阈值需要说明所针对的分辨率、素材版式和失败案例。
- 避免仅用一帧或一个视频验证算法。
- 任何提高召回率的修改都应检查误检和身份交换。
- 识别不确定时优先输出低置信度或“暂未识别”，不要伪造精确位置。

## 最低验证要求

提交前至少运行：

```bash
python -m py_compile local_app.py
node --check local-ui/app.js
```

修改可选 Web 原型时还需运行：

```bash
npm run build
```

涉及轨迹算法时，请记录：

- 测试视频时长和分辨率；
- 回放倍速与采样间隔；
- 分析总耗时；
- `global`、`detected`、`template`、`predicted` 的比例；
- 至少三个时间点的人工画面对照结果。

不要将测试视频提交到仓库。可在 Issue 中提供经授权的外部链接，或提供不含版权素材的合成测试数据。

## Pull Request 清单

- [ ] PR 描述说明了问题、原因和解决方式。
- [ ] 改动没有包含视频、缓存、分析输出或个人路径。
- [ ] 本地分析器语法检查通过。
- [ ] UI 脚本语法检查通过。
- [ ] 新行为有测试或清晰的人工验证记录。
- [ ] 数据字段、区域口径或用户流程变化已同步更新文档。
- [ ] 未无意改变低置信度样本的处理方式。

## Issue 应包含什么

识别问题请尽量提供：

- 视频分辨率、方向和编码格式；
- 小地图在原视频中的大致位置；
- 校准秒数；
- 回放倍速、偏移和采样间隔；
- 期望位置与错误位置；
- 是否发生头像重叠、死亡或遮挡；
- 可公开的截图（如有授权）。

性能问题请提供：

- CPU 型号；
- 视频时长；
- 视频数量；
- 采样间隔；
- 页面显示的进度停留位置；
- 单场实际耗时。

## 数据与隐私

严禁在 Issue、PR、测试夹具或日志中提交：

- 未获授权的完整赛事录像；
- 含访问令牌、Cookie 或账号信息的文件；
- 用户本机目录结构或其他个人信息；
- `local-data/` 中的真实分析结果，除非已脱敏且确认可公开。

安全问题请按 [SECURITY.md](SECURITY.md) 中的方式报告。
