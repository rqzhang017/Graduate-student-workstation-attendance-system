# 素材来源

本项目尽量使用本地静态资源，避免运行时依赖外部网络。素材会记录来源和处理方式，便于后续维护。

## 陪伴橘猫

当前陪伴猫咪是一只原创橘猫，素材保存在 `assets/orange-cat/`。

- 来源：项目作者于 2026-10-02 使用 ChatGPT 图像生成创作。先确定 3D 毛绒风格的角色形象，再以同一形象逐个生成各个姿势。
- 权利：按 OpenAI 使用条款，生成内容归使用者（项目作者）所有。
- 处理：原图为 1254×1254 透明 PNG。入库前清除了透明度低于 12 的生成噪点，把站立和趴卧姿势对齐到同一条落脚线（切换姿势时猫不会上下跳），再缩放为 512px WebP；小鱼干和毛线球裁去留白后缩放为 256px。原图保存在本地 `design/orange-cat-original/`，不入库、不打包。

## 素材映射

| 文件 | 用途 |
| --- | --- |
| `sit.webp`、`blink.webp` | 默认坐姿，以及随机眨眼 |
| `curious.webp` | 鼠标停在舞台上时歪头看过来 |
| `petted.webp` | 撸猫时眯眼享受 |
| `belly.webp` | 好感度很高时被撸，翻肚皮撒娇 |
| `happy.webp` | 戳一戳、撸完、喂食后、下班打卡时开心 |
| `meow.webp` | 打招呼、上班打卡、自言自语 |
| `grumpy.webp`、`surprised.webp` | 被连续戳时闹脾气、吓一跳 |
| `eat.webp` | 喂食 |
| `sad.webp` | 没有猫粮时 |
| `loaf.webp`、`sleep.webp`、`stretch.webp` | 发呆揣手手、久未互动睡着、被叫醒伸懒腰 |
| `study.webp` | 专注计时进行中 |
| `celebrate.webp` | 完成一次专注 |
| `play.webp`、`yarn.webp` | 扔毛线球逗猫，猫会把滚到面前的毛线球拍回去 |
| `fish.webp` | 拖到猫咪身上喂食的小鱼干 |

## 历史素材

v1.2.x 曾使用 [DockCat](https://github.com/Auwuua/DockCat) 默认猫咪 PNG 素材（PolyForm Noncommercial License 1.0.0），现已替换为上面的原创橘猫，相关文件已从仓库移除。
