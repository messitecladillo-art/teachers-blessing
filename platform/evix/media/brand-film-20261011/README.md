# 未见之光 / THE UNSEEN LIGHT

证见 EVI-X 的 4 分钟概念品牌短片。城市追求一个整齐的答案，镜头却回到一扇被遗漏的窗。三维巨构、城市、档案、房间、圆环与棱镜构成叙事；中英双语字幕、原创合成音乐和音效，无旁白。

## 交付与规格

- 成片：`outputs/evix-brand-film-20261011/未见之光-证见EVI-X-1080p.mp4`。
- 轻量播放版：同目录 `未见之光-证见EVI-X-网页播放版.mp4`，保持 1080p 与原音轨；`http://127.0.0.1:3191/screening.html` 提供观影页。
- 1920 × 1080，24 fps，精确 240 秒 / 5760 帧；内部 2.39:1 电影遮幅。
- H.264 / yuv420p，AAC 双声道 48 kHz。母带目标 −16 LUFS、−1.5 dBTP；实测值见成片旁的验收 JSON。
- 源音轨 `score.wav`：48 kHz 双声道 PCM16，无外部采样。
- `script.md`：导演剧本；`shots.json`：叙事节拍与摄影时间线；`captions.json`：字幕。
- `scene.mjs`：三维场景及 31 个实际摄影镜头；`player.mjs`：字幕、播放与逐帧导出。
- `score.py`：原创数值合成器、音符与拟音；`finish.py`：响度母带、MP4 编码及技术验收。

原项目、旧 `media/promo-film/` 和既有 80 秒宣传片均保留。本片在独立目录制作，没有改动产品业务代码。

## 本地预览及重制

需要 Node.js 24 或兼容版本、支持 WebGL2 与 H.264 WebCodecs 的现代 Chromium 浏览器。预览不需要 Python 或 FFmpeg。Three.js 0.186.1 的浏览器模块与 MIT 许可证已随源码收录，不依赖 CDN。

在项目根目录执行：

```powershell
node media/brand-film-20261011/server.mjs
```

浏览器打开 `http://127.0.0.1:3191/`。播放预览、定位镜头或导出影片；页面默认暂停。导出按时间戳逐帧计算，屏幕预览卡顿不会改变成片时长。渲染期间保持页面打开。浏览器仅访问本机服务，服务仅监听回环地址。

重新合成音乐需要 Python 3.12 和 NumPy：

```powershell
python -m pip install -r media/brand-film-20261011/requirements.txt
python media/brand-film-20261011/score.py
```

页面点击“导出全片”，完成后会显示一个渲染目录 ID。安装官方 FFmpeg 并使 `ffmpeg` / `ffprobe` 可被找到，然后执行：

```powershell
python media/brand-film-20261011/finish.py <渲染目录ID>
```

也可用 `FFMPEG`、`FFPROBE` 环境变量指定可执行文件。程序先测量原音轨，再进行响度母带与编码；最后核对时长、尺寸、帧数、音轨参数，并完整解码。渲染中断保留未完成目录，不将其认作成片。默认成片路径会被重制覆盖；保留旧版可传 `--name 新版本.mp4`。

`保存分镜预览` 为每个摄影镜头保存 PNG，供构图与双语字幕审查。源码修改后重新加载页面；不用修改随机种子即可保持几何、纹理和镜头时间的一致。不同 GPU/字体渲染器可能有细微像素差异；重制不是逐字节相同的编码保证。

母版完成后可运行 `python media/brand-film-20261011/web_delivery.py` 生成较小的网页播放版；音轨直接复制，并核对散列一致。`python media/brand-film-20261011/qa.py` 会从实际成片抽取 31 个镜头样帧、总览和海报，依赖 Pillow。

## 制作方式与署名

本片使用当前 Codex 会话及其协作代理编写代码。未调用 Opus 5.5；片头为“证见 EVI-X · 代码生成影像”。所有画面对象、程序纹理、粒子、灯光、摄影运动、字幕排版和音频波形由代码生成。没有使用电影片段、图库照片、AI 生成位图、声音采样或配音。

三维渲染依赖 Three.js；编码依赖浏览器 WebCodecs 与 FFmpeg。音乐通过数值振荡、包络、滤波、延迟、混响及声像合成。它是原创电子与声学拟态配乐，不是实录管弦乐。

本机使用 Microsoft YaHei 与 Arial 渲染字幕，字体文件不随源码分发。公共商业发行前需核对所用字体的适用许可，或改用已获授权的字体重新渲染。Third-party 模块及版本见 `provenance.json`。

## 产品表达与审片

Q → D → I → A 分别表现问题、数据、洞察、行动。影片展示产品的研究方法和价值主张；城市、暖窗、记录与光路是概念意象，不代表真实调查数据或产品现场运行效果。片尾明确保留独立、非官方身份说明。

已经执行的检查与实际结果以 `outputs/evix-brand-film-20261011/*-验收.json` 和制作记录为准。机器检查不能替代完整的人工观影与听音。对外使用前应在实际播放设备上完整播放一次，重点听 112 秒的断乐、124 秒后的细响与 218 秒高潮衔接。

本次交付为可播放的品牌短片及可编辑源码，没有上传发布或报名影展。具体影展的单元、首映和 AI 内容规则要按选定届次另行核对；不作获奖保证。

## 技术参考

- [Three.js 官方文档](https://threejs.org/docs/)
- [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [VideoEncoder](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder)
