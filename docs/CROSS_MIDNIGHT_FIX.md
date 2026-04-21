# 跨午夜下班修复：逻辑工作日方案

## 问题描述

原系统以自然日（`new Date()` 当天日期）作为打卡数据的 key。晚上下班可打卡窗口默认为 20:00–24:00。

若用户在 00:00 之后（如 01:30）才下班，会出现：
1. 晚上下班按钮被禁用（01:30 折算为 90 分钟，不在 1200–1440 区间内）
2. 即使强制写入，数据会落在新一天的 `checkinData[newDate].evening.checkOut`，昨晚的打卡记录永久保持"未下班"

## 解决方案（方案 A）

**核心思路**：定义一个「工作日翻页时刻」（`dayRolloverHour`，默认凌晨 4 点）。在该时刻之前，逻辑工作日仍算前一天。

### 新增全局变量

```javascript
let dayRolloverHour = 4;  // 可在规则设置中修改（0–8）
```

### 新增函数 `getWorkDayString()`

```javascript
function getWorkDayString() {
    const now = new Date();
    if (now.getHours() < dayRolloverHour) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return formatLocalDate(yesterday);
    }
    return formatLocalDate(now);
}
```

### 修改范围

| 位置 | 修改内容 |
|------|---------|
| `updateCheckinButtons()` | 用 `getWorkDayString()` 取当前工作日；晚上下班按钮在滚动窗口内（`isRollover`）始终可用（只要晚上已上班且未下班） |
| `checkIn()` / `checkOut()` | 数据写入 `getWorkDayString()` 对应的 key，不再写到新一天 |
| `checkOut('evening')` | 凌晨下班时，比较合格区间前先 `+1440`（延伸分钟），避免"01:30 < 21:00"误判不合格 |
| `updateCheckinTimeDisplay()` | 读取工作日数据展示 |
| `updateTodayCheckinTable()` | 读取工作日数据展示 |
| `updateTodayStatus()` | 读取工作日数据展示 |
| `recomputeCheckinStatusForDay()` | 晚上 checkOut 时间 HH < dayRolloverHour 时，`+1440` 再判合格，保证历史数据重算正确 |
| `initData()` | 加载时同时确保自然日和工作日的数据条目存在 |
| `saveData()` / `loadAppState()` | `dayRolloverHour` 持久化到 localStorage |
| 规则设置 UI | 新增「工作日翻页时刻」输入框（0–8 点，默认 4） |

### 不受影响的模块

- 手机克制、专注时长、久坐提醒、任务管理：继续用自然日（`getTodayString()`），这些记录与"工作日"归属无关

## 用户体验

- 凌晨 01:30 仍能正常点「晚上下班」，记录写入昨天的数据
- 下班时间显示为实际时间（如"01:30"），不做转换
- 若 01:30 超出合格区间（如 21:00–22:00），状态标注"不合格"——这是正确行为
- 在规则设置中可调整翻页时刻（如调为 0 禁用跨日，调为 6 延长至早 6 点）
