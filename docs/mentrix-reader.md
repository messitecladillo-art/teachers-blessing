# 阅读区 Markdown 与数学排版

`study-render.js` 暴露 `window.StudyRender.markdown(text)` 和 `window.StudyRender.paint(scope)`。协调层在 `ai-client.js` 与本地 Marked/DOMPurify/KaTeX/auto-render 后加载它；`study.js` 的 `markdown` 委托前者，`paintMath` 委托后者。其它 innerHTML 调用仍只接受这个安全 HTML 返回值。模块不覆盖全局 fetch，不请求资源，不调用模型，也不修改已持久化的 Markdown。

此前 Marked 会把 `\[…\]`、`\(…\)` 的反斜杠视为 Markdown 转义符而移除；公式内的 HTTP URL 还会被自动链接拆分，使 KaTeX 无法处理完整公式。现在在 Markdown 前识别四种数学分隔符，用每次新建的 128-bit 加密随机文本标记保护片段；标记若已存在于输入会重新生成，四次失败则完整显示安全原文。仅有局部数组，不跨调用保存来源内容。

保护器跳过 fenced code、inline code、HTML pre/code、标签属性和 Markdown 链接目标。代码里的未闭合 `$` 不会导致正文公式失效，也不占公式预算。可见公式经占位保护后交给现有 `TeachingAI.renderMarkdown`，因此原始 HTML 仍经过 DOMPurify。之后只在临时 DOM 的文本节点中还原标记，使用自建 span 和 `textContent` 保存 TeX；不将来源文字拼接成 HTML、属性或选择器。用户提供的 `data-study-render`/notice 属性额外移除，不能冒充模块能力。返回值中的数据属性仅由模块创建；不要在返回之后再用字符串方式改写 TeX。

`paint(scope)` 查找 scope 本身及内部 `.prose`，只渲染自身创建的数学 span，不扫描所有文本寻找美元符号。代码保持字面量，公式内 URL 不经过 Markdown 自动链接。KaTeX 设置 `trust:false`、`strict:'error'`、`throwOnError:false`、`maxExpand:200`、`maxSize:20`，每式独立 macros；远程 `\href`/`\includegraphics` 等命令不获得链接或资源权限。错误公式保留原文/错误标记，公式渲染不等于数学内容已核实。

沿用阅读区 60000 UTF-16 字符的数学来源预算，单次 markdown 最多 500 片段、每片段最多 8000 字符；每次 paint 跨来源最多处理 500 处。超出正文、数量或单式限制时完整保留安全转义的 Markdown 原文并提示，不静默截断。paint 达到本次总额时，尚未处理的片段保留原文并提示；下一次调用可以继续，已绘制片段不重复处理。未闭合的分隔符保留字面量并提示，正常外部标题和列表继续显示。库或安全随机源缺失时同样显示安全原文。

使用：

```js
prose.innerHTML = window.StudyRender.markdown(savedContent);
window.StudyRender.paint(prose); // 或包含多个 .prose 的容器
```

根页面须保留安全净化资源的加载顺序，并只用已授权内容创建 `.prose`。批注看到的富文本/KaTeX DOM 可能与 canonical Markdown 文本不同；精确锚点无法复现时继续使用现有 unresolved/needs-review 行为，不做近似跳转。

验证命令为 `node --test tests/study-render.test.mjs`。本机真实 Chrome/Playwright headless pipe 1/1 测试通过、0 跳过，包含旧问题的八个案例，以及代码块内未闭合分隔符、外部标题/中文列表、坏公式、原始恶意 HTML、伪造标记、随机碰撞、三个预算与重复 paint。自动网络请求和页面异常均为 0；只使用合成 DOM，没有真实账号、模型或服务请求。浏览器通过项目 playwright-core 与 CHROME_PATH/通用系统路径发现，测试不含个人绝对路径。根页面接线已另行通过独立课程数学10/10和普通界面49/49真实Chrome复验，页面异常为0；数学整页的外部网络请求为0。
