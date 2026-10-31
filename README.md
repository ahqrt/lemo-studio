# 视频工坊 · Lemo 影棚

DeepSeek Harness 里的一个 Lemo-Opuscar 片场。旧的 HyperFrames / 小说分镜 / Remotion 版本已经删除。

```
.dsh-plugin/lemo-studio/     # 插件：Host + Client（React）
films/                       # 每支片一个文件夹（现在为空）
design/                      # 三版设计稿 + 对比页（A 已实现）
lemo-opuscar-dsh/            # Lemo 风格库的本地副本
SETUP.md                     # 依赖、安装、目录、命令
视频工坊-使用说明.md          # 怎么用
```

- 风格库本体在 `~/lemo-opuscar`（66 种风格、`core/render`、`core/tts`）。
- 插件已装进 `~/.dsh/profiles/desktop`，左侧栏「视频工坊」。
- 新片建在 `films/<id>/`；`project.json` + `BRIEF.md` + `TREATMENT.md` + `index.html`。

**海报**：66 张风格海报是 Lemo 的样片图，不在仓库里。首次安装运行 `node .dsh-plugin/lemo-studio/scripts/fetch-posters.mjs`，它会写进插件和 `design/assets/posters/`。

**边界**：工坊不替你画画。它选风格、建组、抽帧、拼分镜、渲染、检查；真正的风格绘制代码由右侧「导演」Agent 读 `STYLE.md` 现写。

开始做第一支片：打开「视频工坊」→ 选一种画法 → 写一句想法 → 建组。
