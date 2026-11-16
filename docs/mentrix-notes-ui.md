# 选区批注客户端

`study-notes.js` 暴露 `window.StudyNotes.install({getContext,api,notify})`，返回 `{locate(note),dispose()}`。不覆盖 fetch、不访问密钥或模型；所有写入只经注入的同源 `api('/highlights',{method:'POST',data})`。重复安装会销毁上一实例。协调层负责在 `study.js` 之前加载脚本、开放静态文件、删除旧 mouseup/批注保存逻辑，并在适当时机刷新笔记列表。

```js
const notes = window.StudyNotes.install({
  getContext: () => ({ userId:S.user?.id, epoch:S.epoch, kp:S.kp,
    lesson:S.lesson, exercise:S.exercise, attempt:S.attempt,
    conversation:S.conversation }),
  api, notify:toast,
});
```

模块创建自己的固定 CSS、`#study-notes-dialog`、`#study-notes-form` 和 `[data-study-notes-toolbar]`，不复用根弹窗或其表单事件。引用使用 `textContent`；模型/用户内容不进入 HTML、属性或选择器。笔记最多 6000 字符；选区去除两端空白后最多 2000 字符，颜色只接受 yellow/green/blue/pink。全文超过 4000000 字符的显示区域不做批注，提示缩小来源。

来源约定：`#source-prose` 对应 `kp.id/kp.revision`；`#lesson-prose` 另固定 `lesson.id`，且 `lesson.sourceRevision` 必须与知识点相同。`.prose[data-message-id]` 固定当前会话的消息 ID，revision 为 1。练习节点需 `[data-note-kind="exercise"][data-note-source][data-note-revision]`；每个可选区块同时有 `data-question-id`、`data-note-block`（stem/reference_answer/solution/feedback），后三类还要 `data-attempt-id`。允许来源属性在外层、题号/区块/作答属性在其内层。属性必须由可信协调层按已授权数据输出；禁止从来源 Markdown 接受这些标记。

mouseup 获取真实 Range，使用选区前缀 Range 的长度计算全区域字符偏移，保存前后各 32 字符。occurrence 是全文中同一 exact 的全局序号，包含重叠匹配；选择第二处不会回退第一处。POST 只发送后端 `learning/annotations.mjs` 的字段：sourceKind/sourceId/revision、按类型的 lessonId/questionId/block/attemptId，以及 exact/prefix/suffix/occurrence/note/color。服务端仍负责 owner、父级、揭示权限、来源版本及最终锚点验证。

capture 固定 userId、epoch、相关实体/版本、原节点和文字。打开与提交前、await 返回后均复核；旧节点断开、版本或账号改变时不保存到新视图。`hashchange` 和在 window/document 上发出的 `study-session-ended` 会清空 toolbar、弹窗引用/输入和定位高亮。旧请求完成时不向新账号显示成功提示；也不会关闭后来新建的选区弹窗。原生 dialog 的迟到 close 事件不会清理新选区。

`locate(note)` 同步返回 `{status:'located'|'not-present'|'needs-review'|'unresolved'}`。协调层应先选择正确 lessonId/conversation/exercise/attempt，再在相应 DOM 完成后调用；not-present 可保留等待异步组件到位。旧来源/评分版本、stale、ambiguous 或 requiresReview 不自动标记；feedback 同时核对 attemptGradingVersion、gradingJobId、gradedAt。真正定位须 exact、occurrence 及上下文在当前 DOM 文字中一致，使用 CSS Custom Highlight 与 Range 滚动；不支持该 API 时选中对应范围，不修改富文本 HTML。

Markdown/KaTeX 渲染后的文本可能与后端原文不同。找不到 exact 或上下文时返回 unresolved，不用近似文本冒充精确位置。后端 occurrence-fallback 的 requiresReview 保存成功时明确提示人工核对，不强行标记。调用者应区分保存成功与准确定位成功。

验证命令：`node --test tests/study-notes-client.test.mjs`。本机真实 Chrome headless/Playwright pipe 1/1 浏览器测试通过、0 跳过，含七组检查：原文重复第二处、讲解恶意引用、消息身份、练习四类区块、版本/账号/评分定位、旧 epoch/hash 清理、切账号后迟到请求。页面异常为 0。证据在 `.collab/mentrix/evidence/producer-notes-browser.json/png`。使用项目 playwright-core 与 CHROME_PATH/常见系统路径发现 Chrome，无个人绝对路径、真实账号、服务或模型请求；根页面与HTTP往返已纳入独立真实Chrome普通操作49/49验收，覆盖四类来源、练习各区块、来源跳回、历史作答、版本与会话；不把需要人工核对的富文本候选说成精确定位。
