# 视频工坊 · Lemo 影棚 · 安装与结构

安装时间：2026-10-31 · 机器：macOS 26.6.2 (Apple M1 Max, arm64)

## 现在是什么

视频工坊已经整个换成 **Lemo-Opuscar**：66 种代码绘制的影片风格 → 简报 → Treatment → 风格帧 → 声音 → 成片。
旧的 HyperFrames 模板、小说分镜、Remotion/Warm、墨金/纸页/霓虹主题、旧工程和旧插件都已删除。

## 依赖

| 组件 | 位置 / 版本 | 说明 |
|---|---|---|
| Lemo 风格库 | `~/lemo-opuscar`（git `88740b2`，66 种风格） | 风格、导演方法、渲染工具都在这里 |
| Python venv | `~/lemo-opuscar/.venv` | `sheet.py`、配音、混音脚本用 |
| ffmpeg / ffprobe | `/opt/homebrew/bin` · 7.1 | 渲染与 mux |
| Chrome / headless shell | Playwright 缓存 | `core/render` 抽帧和整片渲染用 |
| Node | v22.22.3 | 库要求 >= 20 |
| 插件 | `.dsh-plugin/lemo-studio` → `~/.dsh/profiles/desktop` | Host + Client；海报需运行一次 fetch 脚本 |

缺什么先跑一次 Lemo 技能：`sh ~/.agents/skills/lemo-opuscar/scripts/setup.sh deps`。
需要配音时再补 `deps voice`，需要拨弦乐器时补 `deps music`（见库的 `TECHNIQUE.md` §1）。

## 安装 / 更新插件

```sh
cd "$HOME/Desktop/media/video/.dsh-plugin/lemo-studio" && node scripts/fetch-posters.mjs
cd ~/.dsh/profiles/desktop
pnpm add "link:$OLDPWD"
```

`~/.dsh/profiles/desktop/cordis.patch.yml` 末尾：

```yaml
- insert:
    - id: lemo-studio
      name: dsh-lemo-studio
      config:
        workspaceRoot: <absolute path to this workspace>
        debug: true
```

Host 半在 desktop profile 里热加载；**浏览器刷新一次**加载 Client 半。左侧栏出现「视频工坊」。

修改 Client 后重新构建：

```sh
cd "$HOME/Desktop/media/video/.dsh-plugin/lemo-studio"
node scripts/build.mjs
```

## 影片在磁盘上

```
films/<YYYYMMDD-HHMMSS-xxxx>/
  project.json       # 标题、风格、简报、抽帧、渲染、sessionId
  BRIEF.md           # 用户想法 + 交接约定（导演先读）
  film.json          # 骨架标题卡数据
  index.html         # window.DUR / render(t) / READY
  main.js            # 骨架绘制代码；导演会替换成真正的风格画法
  build.sh           # 一条命令重建
  stills/            # look_<t>.jpg
  CONTACT.jpg        # 分镜拼版
  out/               # mix.wav、draft-*.mp4、final-*-master.mp4、版本 sidecar
  voices/            # 配音
  assets/            # 用户素材
  TREATMENT.md       # 导演写
```

## 常用命令（从库里跑）

```sh
cd ~/lemo-opuscar
node core/render/still.mjs "<项目绝对路径>" 1.5 --out "<项目>/stills"
node core/render/video.mjs "<项目>" --fps 24 --workers 3 --out "<项目>/out/draft.mp4"
sh core/render/mux.sh "<video>" "<mix.wav>" "<out.mp4>" 24 2
node core/render/readcheck.mjs "<项目>"
.venv/bin/python core/render/sheet.py "<项目>/CONTACT.jpg" <stills…> --cols 3 --w 640
```

## 验证

```sh
curl -s "$DSH_WEB_URL/lemo-studio/api/state" | head -c 200
```

返回 `styles: 66`、`lib.ready: true`、`films` 列表。旧插件不在 profile 里了。

## 设计稿

三版方向稿与对比页在 `design/`（A 暗房放映厅、B 纸本片场、C 调度台）。最终采用的 A 已实现进插件；B 的版本表/页脚质检、C 的抽帧审查并进来了。
