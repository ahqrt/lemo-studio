# dsh-lemo-studio · 视频工坊（Lemo 影棚）

DeepSeek Harness 的 Web UI 插件。**只做 Lemo-Opuscar**：66 种代码绘制的影片风格 → 简报 → Treatment → 风格帧 → 声音 → 成片。

旧的 HyperFrames 模板、小说分镜、Remotion/Warm 引擎、墨金/纸页/霓虹主题在这个版本里全部移除。

## 它和旧工坊的区别

| | 旧工坊 | 这一版 |
|---|---|---|
| 画面从哪来 | 模板 + 主题色板 | 每种风格现写的 canvas / WebGL 绘制代码 |
| 谁在写 | 插件生成 | 右侧「导演」Agent 读 `STYLE.md` 写，插件负责抽帧、检查、渲染 |
| 项目结构 | `project.json` + shots + compositions | Lemo 影片文件夹：`index.html` 暴露 `window.DUR / render(t)`，工具来自 `$LIB/core/` |
| 交付 | HyperFrames MP4 | Lemo 的 `video.mjs` + `mux.sh`（−14 LUFS / TP −1.2 dB） |

插件不假装一键出片：新建时先写一份**可渲染的骨架**，让时间轴、抽帧、渲染管线先跑通；真正的风格画法由 Agent 在项目里完成，用户在工坊里看帧、点头、渲染。

## 安装

海报不在仓库里（它们是 Lemo 的样片图）。首次安装先跑：

```sh
node scripts/fetch-posters.mjs
```

它会从 Lemo 官方画廊取 66 张海报，写进插件和设计稿的 `assets/posters/`。


```sh
cd ~/.dsh/profiles/desktop
cd "$HOME/Desktop/media/video/.dsh-plugin/lemo-studio" && node scripts/fetch-posters.mjs
cd ~/.dsh/profiles/desktop
pnpm add "link:$OLDPWD"
```

在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾加入：

```yaml
- insert:
    - id: lemo-studio
      name: dsh-lemo-studio
      config:
        workspaceRoot: <absolute path to this workspace>
        debug: false
```

Host 半在 desktop profile 里热加载；**浏览器刷新一次**加载 Client 半。左侧栏出现「视频工坊」。

前提：Lemo 库在 `~/lemo-opuscar`（跑一次 `lemo-opuscar` 技能即可），`core/render` 与 `.venv` 就位。

## 一个影片 = 一个导演会话

建组时 Host 就创建导演会话，并把 `sessionId` 写进 `project.json`；之后**永远**用这一个 id：

- 工坊里没有「新对话」，不会为同一支片再开一个 session；
- DSH 重启后会话变冷，工坊读同一个 sessionId 的磁盘记录（`~/.dsh/sessions/.../session.v4.jsonl.zstd`）并继续 resume；
- 绑定的会话被删除时不会静默新建，而是报「项目会话丢失」；需要人工恢复或明确重建；
- 左侧 DSH 会话列表里的那条「视频工坊 · 片名」就是它，没有第二条。

## 一个影片的磁盘结构

```
films/<YYYYMMDD-HHMMSS-xxxx>/
  project.json       # 标题、风格、简报、抽帧、渲染版本、sessionId
  BRIEF.md           # 用户的想法 + 交接约定（导演先读这个）
  film.json          # 骨架的标题卡数据
  index.html         # 必须暴露 window.DUR / render(t) / READY
  main.js            # 骨架绘制代码；Agent 会换成真正的风格画法
  build.sh           # 一条命令重建
  stills/            # look_<t>.jpg
  CONTACT.jpg        # 分镜拼版
  out/               # mix.wav、draft-*.mp4、final-*-master.mp4
  voices/            # 配音
  assets/            # 用户素材
  TREATMENT.md       # Agent 写
```

## Host API

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/state` | 库状态、66 种风格、影片列表 |
| GET | `/api/styles` | 风格索引 |
| GET | `/api/style/:slug` | 单个风格的 `STYLE.md` + `style.json` |
| GET | `/api/poster/:slug` | 风格海报（插件内置） |
| POST | `/api/films` | 建组，写骨架 |
| GET | `/api/films/:id` | 影片视图（阶段、抽帧、版本、Treatment） |
| PATCH | `/api/films/:id` | 改标题 / 简报 |
| POST | `/api/films/:id/stills` | 抽帧（`core/render/still.mjs`） |
| POST | `/api/films/:id/sheet` | 分镜拼版（`sheet.py`） |
| POST | `/api/films/:id/video` | 渲染草稿/成片（`video.mjs`，有 `mix.wav` 时自动 `mux.sh`） |
| POST | `/api/films/:id/readcheck` | 字幕停留检查 |
| POST | `/api/films/:id/annotate` | 按框选区域裁图 + 标注全图，交给导演 |
| GET | `/api/films/:id/file?p=` | 项目文件（支持 Range，视频可播） |
| POST | `/api/films/:id/chat/session` | 建/复用导演会话 |
| POST | `/api/films/:id/chat/send` | 把这一轮任务交给导演 |
| GET | `/api/chat/history?sessionId=` | 会话消息 |
| GET | `/api/jobs/:id` | 任务日志与结果 |

任务全部是**子进程**：动画渲染是浏览器 + ffmpeg，抽帧几百毫秒，45 秒 1080p 成片通常几分钟。页面轮询任务，不阻塞 Host。

## 开发

```sh
cd .dsh-plugin/lemo-studio
node scripts/build.mjs     # 打包 src/client/entry.jsx → client.js
```

`lib/library.js` 只读风格库；`lib/project.js` 管项目文件夹；`lib/render.js` 跑工具；`lib/agent.js` 写交给导演的 prompt。风格库保持只读，永远不编辑 `$LIB/core` 或 `$LIB/styles`。
