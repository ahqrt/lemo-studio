/**
 * The director handoff.
 *
 * The studio does not write films with templates. It gives a competent agent
 * the project folder, the style spec and one clear job, then keeps the review
 * loop (frames, checks, renders) in the UI.
 */

const ACTION_LABEL = {
  start: '开工',
  treatment: '改 Treatment',
  look: '改风格帧',
  storyboard: '做分镜',
  sound: '做声音',
  film: '做整片',
  chat: '对话',
}

const STYLE_RULES = [
  '风格照抄，故事自己写：STYLE.md 的看、色、字、动、镜头语法、声音全部保留；故事、结构、镜头内容按用户的想法重新导演，不要照搬 DEMO.md 或 demo 源码。',
  '先小后大：先一张风格帧，再 10–15 秒，再整片。每一关都真的跑检查，不要"看着差不多"。',
  '一次只改一处：画面错改绘制代码，时间轴错改 timeline，成片错改 mix/mux；三类一起动无法归因。',
  '不要执行整片渲染，除非用户明确要求；抽帧、contact sheet、10–15 秒草稿可以做。',
  '所有命令从库里跑：`cd "$LIB" && node core/render/still.mjs "<项目绝对路径>" 1.5`。项目里的页面用绝对 URL `/core/lib.js`。',
  '工作区外（尤其是 $LIB）只读：不要安装依赖、不要下载采样库、不要写 $LIB。缺 voice/采样库就停下来告诉用户命令和体积，等用户明确同意，不要请求 danger-full-access。',
  '声音优先用 $LIB/core/audio 的合成工具和项目里已有素材。需要外部采样库时，先说明为什么非它不可；能用合成替代就用合成。',
]

export function actionLabel(action) {
  return ACTION_LABEL[action] || ACTION_LABEL.chat
}

export function buildPrompt(film, view, body = {}) {
  const action = ACTION_LABEL[body.action] ? body.action : 'chat'
  const message = String(body.message || '').trim().slice(0, 4000)
  const stage = String(body.stage || view?.stage || 'brief')
  const style = film.style
  const dur = film.brief.duration
  const lang = film.brief.language
  const lines = [
    `【视频工坊 · ${ACTION_LABEL[action]}】《${film.title}》`,
    '',
    '【项目】',
    `目录：${film.dir}`,
    `Lemo 库：${film.lib}`,
    `风格：${style.cn} ${style.en}（styles/${style.slug}）`,
    `语言：${lang}｜时长：${dur} 秒（硬约束）｜画幅：1920×1080 · 24 fps`,
    `声音：${film.brief.voice ? '要配音' : '不做配音'}｜分镜：${film.brief.storyboard ? '用户要先看' : '不用先停'}`,
    `当前阶段：${stage}`,
    '',
    '【必须读的文件】',
    `- ${film.dir}/BRIEF.md：用户的想法与交接约定`,
    `- ${film.lib}/styles/${style.slug}/STYLE.md：风格不变量，完整读`,
    `- ${film.lib}/AGENTS.md、DIRECTOR.md、dsh/DEEPSEEK.md：做法与节奏`,
    `${action === 'start' || action === 'treatment' ? '- 在写完 TREATMENT.md 之前，不要打开 DEMO.md 或 demo 源码。' : ''}`,
    '',
  ]
  const task = []
  if (action === 'start') {
    task.push(
      '1. 先写 TREATMENT.md：三个结构方案各几行，选一个并说明为什么；logline、setup→turn→ending、镜头表（景别/角度/运镜/时长/为什么）、逐秒节拍、cue map、声音设计表。',
      `2. 用真实绘制代码替换 index.html / main.js 的骨架。先只做一张 t≈1.5s 的风格帧，逐条对 STYLE.md（材料、颜色、字、母语动作），不对就改。`,
      `3. 过第一关后，抽 3 张：cd "$LIB" && node core/render/still.mjs "${film.dir}" ${(film.lookTimes || [1.5]).join(' ')} --out "${film.dir}/stills" --prefix look_`,
      '4. 回报：这一版最像风格的三处、最不确定的一处、下一步建议。不要直接渲染整片。',
    )
  } else if (action === 'treatment') {
    task.push('重写或修订 TREATMENT.md；改动写清楚是哪一段、为什么。不要动绘制代码。')
  } else if (action === 'look') {
    task.push(
      '只改绘制代码里被指出的那一处，不要动时间轴。改完重抽同一组时间点，把 3 张并排给用户看。',
      `重抽命令：cd "$LIB" && node core/render/still.mjs "${film.dir}" ${(film.lookTimes || [1.5]).join(' ')} --out "${film.dir}/stills" --prefix look_`,
    )
  } else if (action === 'storyboard') {
    task.push(
      '做 6–9 张关键帧，覆盖开场、转折、结尾；用真实绘制代码抽帧，再用 core/render/sheet.py 拼一张 CONTACT.jpg，标上镜号、景别、时长。',
      '拼完停下来，等用户确认；不要继续做整片。',
    )
  } else if (action === 'sound') {
    task.push(
      '先定配音：中文优先 core/tts/tts_zh.py（edge-tts），离线才用 tts.py。逐条回读 asr_check.py；不对的改字或改读法。',
      '再做配乐和混音：写 mix.py，至少两段真正的静音，音乐在关键动作上让路；输出 out/mix.wav。',
      '不要整片渲染；混音完成后告诉用户可以渲染。',
    )
  } else if (action === 'film') {
    task.push(
      '先渲染 10–15 秒草稿看节奏（video.mjs + mux.sh），过了再整片。',
      '整片后跑 readcheck（页面要有 window.TEXTS），用 mux.sh 做 −14 LUFS / TP −1.2 dB，检查无黑帧、字幕不压主体。',
      '把成片路径、时长、响度、还差什么，一次说清楚。',
    )
  } else {
    task.push('先判断问题出在绘制代码、时间轴还是成片，再给可执行的修改；不确定就问一句。')
  }
  lines.push('【这一轮要做的事】', ...task, '')
  lines.push('【约定】', ...STYLE_RULES.map((rule) => `- ${rule}`), '')
  lines.push(`用${lang === 'English' ? 'English' : '中文'}回报；只说你改了什么、验了什么、还差什么。`, '')
  const fallback = action === 'start'
    ? '开工：读 BRIEF.md 和 STYLE.md，先写 TREATMENT.md，再出第一版风格帧。'
    : action === 'treatment'
      ? '按 BRIEF.md 重写 TREATMENT.md。'
      : '（没有额外的话，按这一轮的任务做。）'
  lines.push('【用户】', message || fallback)
  return lines.filter((line) => line !== undefined).join('\n')
}

/** The one-line context shown in the UI before a session exists. */
export function starterLine(film) {
  return `${film.style.cn} · ${film.brief.duration} 秒 · ${film.brief.language} · 等导演写 Treatment`
}
