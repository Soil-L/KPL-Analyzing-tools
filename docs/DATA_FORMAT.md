# 数据格式

本地程序会生成两类数据：

1. 服务端保存的单场分析 JSON；
2. 浏览器导出的批量数据集 JSON 和全时间点概率 CSV。

## 坐标系统

- `x`、`y` 使用 0–100 的百分比坐标。
- `(0, 0)` 是地图左上角。
- `(100, 100)` 是地图右下角。
- `videoT` 是视频文件秒数。
- `t` 是换算后的游戏秒数。

换算公式：

```text
t = videoT × playbackSpeed + gameOffset
```

## 单场分析 JSON

单场结果保存在：

```text
local-data/analysis-YYYYMMDD-HHMMSS.json
```

顶层示例：

```json
{
  "version": 1,
  "trackingVersion": 3,
  "createdAt": "2026-07-26 13:31:23",
  "source": {
    "path": "D:\\videos\\match-01.mp4",
    "name": "match-01.mp4",
    "videoDuration": 299.57,
    "playbackSpeed": 4,
    "gameOffset": 2,
    "gameDuration": 1200.28,
    "sampleSeconds": 2
  },
  "crop": {
    "x": 0,
    "y": 440,
    "w": 1080,
    "h": 1080
  },
  "players": []
}
```

### player

```json
{
  "id": "blue-1",
  "team": "blue",
  "thumbnail": "data:image/jpeg;base64,...",
  "samples": []
}
```

`id` 只保证在一场分析内唯一。跨场聚合必须使用用户填写的真实队名和分路，不能依赖 `blue-1` 之类的临时 ID。

### sample

```json
{
  "t": 246.0,
  "videoT": 61.0,
  "x": 36.75,
  "y": 18.54,
  "confidence": 0.94,
  "source": "global",
  "detectionScore": 0.91,
  "globalScore": 0.89,
  "direction": "forward"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `t` | number | 游戏时间（秒） |
| `videoT` | number | 视频时间（秒） |
| `x` | number | 地图横向百分比坐标 |
| `y` | number | 地图纵向百分比坐标 |
| `confidence` | number | 综合置信度，范围约 0–1 |
| `source` | string | `global`、`detected`、`template` 或 `predicted` |
| `detectionScore` | number | 当前圆环候选的颜色检测分数 |
| `globalScore` | number | 全图头像模板匹配分数 |
| `direction` | string | 从校准点向 `forward` 或 `backward` 分析 |

## 批量数据集 JSON

浏览器导出格式：

```json
{
  "version": 2,
  "createdAt": "2026-07-27T12:00:00.000Z",
  "regionDefinition": {},
  "matches": [],
  "probabilitySeries": []
}
```

### matches

每一项包含单场分析结果，以及人工填写的：

```json
{
  "teamNames": {
    "blue": "Team A",
    "red": "Team B"
  },
  "roleMapping": {
    "blue-1": "对抗路",
    "blue-2": "打野"
  },
  "heroNames": {
    "blue-1": "英雄名称"
  }
}
```

### probabilitySeries

```json
{
  "time": 600,
  "team": "Team A",
  "role": "打野",
  "validMatches": 4,
  "probabilities": {
    "己方红区": 0.25,
    "己方蓝区": 0.5,
    "对方红区": 0,
    "对方蓝区": 0,
    "对抗路": 0,
    "中路": 0.25,
    "发育路": 0
  }
}
```

同一行的概率以该队伍、分路、时间点的 `validMatches` 为分母。置信度低于 0.5、超出比赛时长或离目标时间过远的样本不会进入分母。

## 概率 CSV

CSV 使用 UTF-8 BOM，便于 Excel 正确识别中文。

列：

```text
时间秒,时间,队伍,分路,有效场次,己方红区,己方蓝区,对方红区,对方蓝区,对抗路,中路,发育路
```

概率列使用百分数数值，不带 `%` 符号。例如 `25.00` 表示 25%。

## 兼容性约定

- 消费者应先检查顶层 `version` 和 `trackingVersion`。
- 新字段应以向后兼容方式增加。
- 不要假设每个时间点都有十个有效位置。
- 不要将数组顺序解释为固定分路；应读取 `roleMapping`。
- 不要公开包含本机绝对路径的原始导出，分享前应脱敏 `source.path`。
