# 已保存学习内容的离线导出

`learning/export.mjs` 提供：

```js
import { renderOfflineLearningHtml } from './export.mjs';
const html = await renderOfflineLearningHtml({ title: artifact.title, content: artifact.content });
```

只使用当前用户已持久化的学习 Markdown；讲解、个人笔记或追问是否纳入，由创建产物的现有流程决定。本函数不读账号数据、不调用模型、不补写新内容，也不承担 owner/父级/版本鉴权。下载层须先完成授权，再设置 `Content-Type: text/html; charset=utf-8` 与安全的 `.html` 附件文件名。`?format=html` 的 HTTP 接入属于 services；不应将浏览器参数传入 `root`。可选 `root` 只供受信任部署/测试指定项目根，模块只读取其固定 `assets/vendor/` 文件和已知命名的 KaTeX WOFF2 字体，不接受任意资源路径。

输出是一份自有模板 v1 的单文件 HTML。固定内嵌项目已有的 Marked 15.0.12（MIT）、DOMPurify 3.4.18（Apache-2.0 OR MPL-2.0）、KaTeX 0.19.1（MIT）及 auto-render，20 个 WOFF2 字体替换原 CSS 的相对字体地址。原始 LICENSE 全文保留在页面折叠区；页面亦记录实际读取文件的 SHA-256，字体来源沿用 `assets/vendor/katex/source.json`。未执行上游安装/生命周期脚本，未下载其它依赖。固定资源在进程内按项目根缓存，至多 4 份；更新 vendor 后应重启服务。

标题最多 240 UTF-16 字符。正文最多 2000000 UTF-16 字符，且最多 4000000 UTF-8 字节，不静默裁剪。非法数据抛出 `status:400, code:EXPORT_INVALID_INPUT`；正文超限为 `EXPORT_TOO_LARGE`；固定资源缺失或不合规格为 `status:503, code:EXPORT_ASSETS_UNAVAILABLE`，公开错误不含本机路径。

标题、许可证和无脚本正文均做 HTML 转义。模型/用户正文只通过 JSON 数据块进入页面，并转义 `<`、U+2028/U+2029；库源码也以安全 JSON 字符串内嵌，再由带 nonce 的受信任加载器创建 inline script，避免 `</script>` 提前终止。每份 HTML 使用随机 CSP nonce：脚本只允许该 nonce，网络连接、对象、frame、worker、表单提交均禁止；字体只允许 `data:`，样式允许内嵌。没有外链脚本、样式、字体或页面初始化联网步骤。

正文依次经 Marked、DOMPurify 严格标签/属性白名单，再渲染数学。原始 script/style/iframe/form/svg/MathML/媒体与图片全部禁止；原始 style/id/name/src 等属性不可进入正文。HTTP(S) 引用链接可保留，只有用户显式点击才打开新窗口，并设 `noopener noreferrer`；其它协议移除。原始内容中的命令或代码只当文本，不执行。页面打开后的恶意内容防护依赖现代浏览器支持 CSP 与项目固定净化库；不要把学习 Markdown 当任意可信网页部署。

数学支持 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`。先把最多 500 处、每处最多 8000 字符的表达式隔离为文本节点，避免 Markdown 吞掉反斜杠；仅对这些受限节点运行 KaTeX，代码块保持代码。设置 `trust:false`、`strict:'error'`、`maxExpand:200`、`maxSize:20`；不支持的命令显示错误标记。未闭合或超过数学预算时停止数学排版、保留文本并明确提示，不伪造渲染成功。

“打印 / 存为 PDF”只调用浏览器 `window.print()`。用户在本机打印对话框选择 PDF；没有宣称服务器提供原生 PDF 下载，也不保证论文/出版物的最终分页。打印样式隐藏工具和许可证折叠区，保留正文，使用 A4 页边距。JavaScript 关闭时 `<noscript><pre>` 保留安全转义的原文，可直接阅读。

验证：`node --test tests/study-export.test.mjs`，本机 3/3 通过、0 跳过。真实 Chrome headless 经 Playwright pipe 打开 `file://`，验证 Markdown/Unicode/数学、完整内嵌字体、关闭 JS 原文、公式超限、恶意闭合 script/远程图片/SVG/iframe/样式/LaTeX 不执行；捕获网络请求和页面异常均为 0。浏览器 PDF 实际输出 `%PDF-`、77853 字节，HTML 为 765873 字节；截图已人工检查。复验证据为 `.collab/mentrix/evidence/export-browser.json`、`export-browser.png`、`export-browser.pdf`。测试只用合成内容，无真实密钥或模型调用；HTTP下载与本人账户成果汇编另经独立6/6集成验收；显式揭示只影响新生成的学习快照，旧快照不会补入参考答案。
