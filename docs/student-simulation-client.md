# AI学生模拟对话组件

教学复盘页中的AI学生对话使用真实服务会话与模型任务。首次点击“开始模拟”会先保存会话，再保存一条明确的本人起始发言，等待服务端AI学生回复；不会用前端固定气泡冒充模型。好奇追问、易混淆、安静思考三种互动类型对应 `curious / misconception / quiet`。

所有气泡分别标明“AI学生 · 模拟”和“本人讲解”。这不是实际学生、真实班级反馈或教学能力评分。本人自行编写的“模拟演练记录”仍是另一种材料分类，不会被本组件改成AI对话历史。

## 持久记录与边界

- 当前版本的模拟会话可从历史下拉选择；重载后读取服务端保存的教师发言、AI回应及长任务。
- 每会话最多12轮，计已发起的本人发言。失败/取消后只能恢复原任务回应该条发言；恢复第12轮不会新增轮次。离开页面不取消服务端任务。
- 当前任务/来源/版本变化后，旧会话仅可回看。每次新发言前重新读取当前教学任务与学生版本DTO，服务端仍作最终来源校验。
- 创建和发言分别保留UUID请求标识，未知网络回执重试沿用原标识；成功确认后重复发送相同文字属于新一轮。
- 页面只读取 `?audience=student` 的教学版本，不读取教师参考答案。后台模型输入白名单、来源约束与取消迟到保护见[服务说明](mentrix-student-simulation.md)。
- 回复通过现有受限Markdown/数学渲染器处理，并移除媒体、脚本、表单、SVG及组件动作属性；无渲染器时降为文本。不会自动加载模型提供的远程图片或视频。

## 接线

```js
const student = StudyStudent.install({ api, getContext, notify });
await student.mount(host, { packId, versionId });
student.contextChanged(); // userId / epoch / book变化，或host被移除
student.unmount();       // 切换标签/教学版本时卸载；不取消后台任务
student.dispose();       // 最终销毁
```

`getContext()` 返回 `{userId, epoch, book, config}`，`config.modelConfigured` 必须明确为true才启用发言。根教学页负责在版本或模拟标签变化时重新mount/unmount。旧视图的异步响应、计时器及草稿不会进入新host或新账户。

接口为 `GET/POST /teaching-packs/:packId/versions/:versionId/student-simulations`、`GET /student-simulations/:id`、`POST /student-simulations/:id/messages`（`content≤3000`，`clientRequestId`），以及既有`/jobs/:id`的轮询、取消和恢复。会话详情嵌入messages，并提供activeJobId/lastJobId；没有虚构的单独消息历史GET接口。

## 本轮验证范围

`tests/study-student-client.test.cjs` 用合成DOM/API检查显式创建与发送顺序、请求幂等、确认后同文新轮、只读历史、12轮恢复、旧视图/账户隔离和卸载；没有调用真实模型，不证明浏览器视觉、Markdown渲染链或真实AI回应的教学质量。这些需接线后的独立浏览器/服务验收。

样式沿用森林绿、米白、重宋Display900，宽屏左设置右对话，680px以下单栏。不能仅凭样式文件声称与18设计稿100%一致。
