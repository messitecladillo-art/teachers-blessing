# AI 学生演练（U11）

这是一位由模型扮演的学生，供教师练习提问和解释。所有会话、教师发言与模拟回复均标记 `classification: simulated`、`abilityCertified: false`；它们不是实际学生反馈、课堂观察或能力认证。

## 接口

以下路径均位于 `/api/v1` 下，沿用本地登录与所有者隔离。

| 方法与路径 | 输入 | 响应 |
| --- | --- | --- |
| GET `/teaching-packs/:packId/versions/:versionId/student-simulations` | 无 | `{items,total,truncated}`；当前版本最近 50 个会话，旧版本也可只读 |
| POST 同上 | `{profile,clientRequestId?}` | 201 新会话；相同 UUID、相同输入重放 200 |
| GET `/student-simulations/:id` | 无 | 会话与嵌入的完整消息列表 |
| POST `/student-simulations/:id/messages` | `{content,clientRequestId}` | 202 持久任务 `type: student-simulation` |
| POST `/jobs/:id/cancel` | `{}` | 沿用队列取消，不追加 AI 回复 |
| POST `/jobs/:id/resume` | `{}` | 沿用显式恢复，复用原教师发言，不新增轮次 |

`profile` 严格为 `curious`、`misconception`、`quiet`。所有请求标识使用 UUID。会话 DTO：

```js
{
  id, packId, versionId, textbookId, title, profile,
  messages: [{ id, role: 'teacher' | 'student', content,
               classification: 'simulated', createdAt,
               sourceIds?, replyTo?, clientRequestId? }],
  turnCount, maxTurns: 12, activeJobId, lastJobId,
  latestJobId?, latestJobStatus?, stale, staleReason,
  sourceVersions, classification: 'simulated', abilityCertified: false,
  createdAt, updatedAt
}
```

`turnCount` 是已发起的教师轮数，包含取消或失败后尚未收到回复的轮次。每会话最多 12 个教师轮次及对应的 12 个模拟回复。教师每条最多 3000 个 UTF-16 字符，回复最多 2000 个。`activeJobId` 仅在排队、运行或取消中非空；`lastJobId` 在终态继续保留，方便刷新后读取失败原因或显式恢复。任务 `payload` 包含 `sessionId`、`teacherMessageId`、`sourceFingerprint`；成功 `result` 为 `{sessionId,studentMessageId}`。

相同发言 UUID 重放会返回同一个任务，内容改变则 409。取消或失败后重放不会暗中再次调用模型，须显式恢复该任务。最后一个教师轮次未收到回复时，不能另追加教师发言；可恢复任务，或新建会话。创建会话本身无需模型配置；真正发送发言需要模型，未配置返回 503，且不保存发言或预算预留。

## 来源与隐私边界

仅当前教学包内容版本可创建及继续模拟。来源检查复用教学包的 `prepare`，并核对本人教材、章节、知识点修订、文件状态、当前文件和来源锚点。教材文字、任务、当前版本或安全教学内容发生改变时，旧会话可读但标记 `stale`，迟到回复及恢复均拒绝；父教学任务删除后返回 404。

传给模型的对象采用正向白名单：教学任务；教学目标与步骤的标题、时间、学生行动；任务单题干；绑定教材知识点正文与真实来源 ID。教师行动、检查提示、教师参考答案、评分标准、个人理解记录及复盘均不进入模型输入；已揭示教师参考也不会改变这一边界。模型输出只接受 `{reply,sourceIds}`，来源必须属于本次真实白名单，不接受额外评分字段。

最多 10 个知识点、来源正文合计 16000 字符；超出逐来源截断并带 `truncated`、`coverage.partial`。模型历史仅最近 9 条消息，整个 JSON 输入最多 58000 字符，超出明确失败。原始会话仍保存完整最多 24 条消息。固定系统规则与不可信教材、教师发言分别放在 system/user 消息；这是一项防护设计，不表示可抵御所有提示注入。

## 持久任务与验证范围

会话存在既有 `artifacts` 集合，`type: student-simulation`；未新增存储集合。消息提交、预算和队列准入处于同一个原子事务。生成复用学习任务队列、超时、取消、账本和重启机制；提交时再次检查所有者、当前版本、来源指纹、任务身份及最后待回应发言。服务重启会把未完成任务标为 `interrupted`，需手动恢复，绝不自动重发模型请求。

生产者验证使用自编合成分数材料、两个本地测试账号和 mock 模型：新增 14 项测试通过，涵盖正常持久与重启、隐私白名单、幂等、越权、取消后忽略 abort 的迟到返回、来源/任务/版本/父链改变、缺模型、预算不足、坏 JSON、12 轮上限及中断恢复。连同既有学习、教学和核心 API 的定向回归共 79 项通过。未调用真实供应商，未读取真实用户教材；这些记录不替代独立审查或浏览器验收。
