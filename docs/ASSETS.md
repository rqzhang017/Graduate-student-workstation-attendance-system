# 素材来源

本项目尽量使用本地静态资源，避免运行时依赖外部网络。第三方素材会记录来源和授权，便于后续维护。

## 陪伴猫咪

当前陪伴猫咪使用 DockCat 默认猫咪 PNG 素材，并保存到 `assets/dockcat/`。

- 原项目：[Auwuua/DockCat](https://github.com/Auwuua/DockCat)
- 许可证：[PolyForm Noncommercial License 1.0.0](https://github.com/Auwuua/DockCat/blob/main/LICENSE.txt)
- 使用范围：个人、科研、教育和其他非商业用途。

## 素材映射

| 本项目文件 | DockCat 原始路径 | 用途 |
| --- | --- | --- |
| `assets/dockcat/loaf.png` | `DockCatApp/DockCat/Resources/DefaultCat/poses/resting/loaf.png` | 默认/好奇状态 |
| `assets/dockcat/side.png` | `DockCatApp/DockCat/Resources/DefaultCat/poses/resting/side.png` | 信任状态 |
| `assets/dockcat/happy.png` | `DockCatApp/DockCat/Resources/DefaultCat/poses/dialogue/stand.png` | 开心/超喜欢状态 |
| `assets/dockcat/stretch.png` | `DockCatApp/DockCat/Resources/DefaultCat/poses/transition/stretch.png` | 点击猫咪反馈 |
| `assets/dockcat/feed.png` | `DockCatApp/DockCat/Resources/DefaultCat/poses/resting/bread.png` | 喂食反馈 |

## 本项目修改说明

- 将 DockCat 默认猫咪姿势接入本项目的猫咪陪伴区域。
- 根据本项目已有的好感度状态映射 loaf、side、happy 三类常驻姿势。
- 点击猫咪时临时切换为 stretch 姿势。
- 喂食猫咪时临时切换为 feed 姿势，并保留本项目原有猫粮、好感度、台词和统计逻辑。

## 授权边界

DockCat 及其素材采用 PolyForm Noncommercial License 1.0.0。本项目从当前版本开始同样采用 PolyForm Noncommercial License 1.0.0，不再采用 MIT License。请勿将本项目或其中的 DockCat 素材用于销售、收费分发、商业产品捆绑或其他商业用途。
