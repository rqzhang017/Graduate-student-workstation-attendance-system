# Graduate Student Workstation Attendance System

一个面向博士生/研究生日常工位管理的单文件前端应用。

## Features

- 工位打卡：上午、下午、晚上三段上下班打卡
- 规则设置：可配置打卡时间窗与合格时间窗，修改后立即生效
- 专注时长：支持自定义倒计时、到点提醒、当日专注记录
- 任务管理：开始/结束任务并统计任务时长
- 手机克制：记录每日克制次数
- 请假记录：管理请假日期与理由
- 统计分析：查看打卡、任务、专注和手机克制数据

## Tech Stack

- 单文件 HTML
- Tailwind CSS CDN
- Chart.js CDN
- localStorage 本地持久化

## Usage

1. 直接在浏览器中打开 `博士上班打卡 .html`
2. 所有数据默认保存在当前浏览器的 `localStorage`
3. 适合个人离线使用，不依赖后端服务

## Notes

- 当前为纯前端单体应用
- 更换浏览器或清空浏览器缓存后，本地数据不会自动迁移
