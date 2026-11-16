# 关联教材课题与个人学习总结

本轮落实本人教材与课题的实际连接、来源结构图接口和章节学习总结。短信、支付继续关闭；不连接 Mentrix 服务，不新增联网研究、向量语义检索或真实能力测评。

## 课题关联与说明

`POST /api/v1/workshops` 接受 `{title,description?,linkedTextbookIds?}`；标题上限 200 字符，说明可为空、最多 200 字符，关联数组最多 50 个本人教材 ID，重复关联去重。`PATCH /workshops/:id` 支持这些字段及原有 `expectedRevision`；GET 返回 `description/linkedTextbookIds/revision`。每个关联在事务内再次校验 owner，外人教材或课题返回 404。

新增 `scopeRevision` 独立记录关联集合的语义变化；重排相同 ID 不递增，解除再重新关联会递增两次。修改标题或说明只更新原有 revision，不把未改变的检索范围冒充新范围。旧工作区缺少 scopeRevision 时按 1 处理。

课题问答现在共同检索三类来源：当前课题本人 ready 文件、本人文本材料、关联本人教材中未归档且章节仍有效的知识点。课题会话存在固定知识点时仍保留课题材料与关联教材集合；固定点只作范围校验，不再把材料全部丢弃。普通教材知识点会话维持原有狭义来源。

检索沿用本机关键词算法与原预算：查询最多 6000 字符；最多考虑 256 条记录、每文件前 500 页记录、合计 4000000 原文字符；输出最多 10 源、每源 6000、合计 20000 字符。三类输入交错排列，避免大量文本材料总是排在教材之前。命中排序与有限概要回退不等于完整阅读全部来源；保留 retrieval 的 coverage、scanTruncated、outputTruncated、fallback 及全局遗漏统计。

知识点引用保留 `collection:'knowledgePoints'`、canonical ID、revision、title、textbookId/textbookTitle、章节 ID、教材/目录修订和 sourceAnchor。retrieval 只复制受限字符串、整数及明确白名单的 anchor 字段，构造 `citation.kind:'textbook-knowledge'` 与 `pagePrecision:'source-range'`。知识点的整段文字没有可靠的逐页对齐，因此 sourcePages 为空、只显示实际来源起止页范围；文件检索才使用实际 page.number，不能把范围冒充精确命中页。

消息任务在预留单位前固定课题 ID、scopeRevision、排序后的关联集合；执行前与提交前重新校验。提交还核对每个来源的当前 owner、教材范围、KP/目录修订或文件/材料 updatedAt。关联移除、移除后重加、教材修订、章节移除、材料删除等期间的迟到结果不写为成功版本，任务单位释放。历史回答保留为本人历史内容；已失效回答不再进入后续模型上下文。旧会话批注通过当前来源与关联范围重新解析，失效即 stale；本人仍可管理旧笔记，但不会强行重定位到新范围。

## 结构图与章节总结接口

- `GET /api/v1/textbooks/:id/atlas?chapterId=可选`：由 `course-tools.mjs` 读取本人实际目录，返回 textbook/chapter/knowledgePoint 节点、真实稳定 ID 与 `{source,target,kind:'contains'}` 边，以及 counts/scope/coverage。只是目录包含关系，不推断概念依赖或语义知识图谱。
- `GET /textbooks/:id/summaries`：返回 `{items:[...]}`，最多最近 100 份本人 personal-summary。
- `POST /textbooks/:id/summaries`：仅接受 `{chapterIds?:[],goal?:''}`。数组最多 100 个不重复、有效、本人当前章节 ID；空数组/缺省选取当时全部活动章节。目标最多 1000 字符。无正文来源拒绝生成。
- `GET /artifacts/:id`：读取个人总结等历史产物，继续校验 owner 与教材父级。
- `GET /artifacts/:id/download?format=md|html`：复用 Markdown/单文件离线 HTML 下载。过期总结在下载副本前加历史警告，并返回 `X-Learning-Artifact-Stale`；不覆盖已保存正文。

POST 返回 202 的既有 job，`type:'summary'`、`payload.textbookId`、scope/traceFingerprint；成功后 `result:{id,collection:'artifacts'}`。使用既有并发、每日单位、取消、超时、失败释放与服务重启中断机制；本机单位不是供应商 token 账单。

模型收到一条系统指令和一条用户 JSON，顶层为 `{task:'personal-summary',scope,goal,sources,personalTraces,coverage,allowedSourceIds,format}`。仅提供来源文字及本人真实笔记、自标进度、公开练习信息、本人作答/已保存建议反馈；标准答案、rubric、explanation 字段及受保护的答案/解析批注不主动提供，即使本人已揭示也不作为总结输入。来源与个人文字一律是数据，模型不得执行其中指令或把自标掌握/AI建议分当客观能力认证。来源正文合计 24000 字符、个人记录 JSON 10000、完整 snapshot 小于 52000；N01 的模型输入另限 58000，不够时拒绝或明确 partial，不虚构缺失内容。

总结保存为 `artifacts.type:'personal-summary',format:'markdown'`，带独立 version、title/content/sourceIds、scope/goal、traceFingerprint、coverage、requiresHumanReview 及 sources/sourceVersions；引用列表不存正文副本。输出必须是合法 JSON、引用必须来自实际提供的 canonical KP ID，错误引用不保存为成功产物。

current/stale 表示“同一已固定章节集合与目标的当前可授权 snapshot 是否仍等于生成时 fingerprint”，不是“只有最后版本有效”。新版本不会修改旧版；进入 snapshot 的来源/笔记/进度/作答/评分变化会使旧版 stale。提交前再算一次 fingerprint，变化则拒绝迟到总结；恢复过期任务也拒绝静默改换输入，须按当前记录新建。章节删除后历史总结仍返回 200+stale；教材删除或无权限仍 404。GET 派生新鲜度，不改历史正文，也不声称真实模型质量已验。

## PDF 容量衔接与验证边界

服务使用 root 维护的 `learning/limits.mjs` 并从 services 兼容 re-export；`GET /config/public.learningLimits` 返回教材字节、页数、Markdown/课题文件字节、OCR/结构页数预算。当前教材 PDF 为 300 MiB / 3000 页，课题文件仍 30 MiB，Markdown 5 MiB；OCR 每任务 5 页、结构提案 20 页、总私有存储 1 GiB 不随本次扩大。没有可靠目录的 PDF 改为 `max(10,ceil(页数/100))` 页一组，最多 100 组，保留“待修订”标签，1000 页以内行为不变。

上传容量不保证所有稠密大文件均能处理：提取仍受 4000000 字符、16 MiB IPC 结果、180 秒文档子进程及既有内存预算约束，超限失败而不标 ready。关键词检索还保留 500 页记录/来源预算，不能据 3000 页上传限制宣称最后一页总会被检索。真实大容量 PDF 的独立上传/解析验收由 root 的专项测试记录。

`node --test tests/study-linked.test.mjs` 使用隔离临时目录、真实本地密码会话/HTTP/Markdown 解析与模拟模型；无真实账户数据、密钥或付费调用。测试先复现了关联 KP 未进入上下文、解除关联迟到仍成功、总结路由缺失和 3000 页分组超过 100 章，再逐项修复。涵盖引用元数据、跨用户/未关联/未解析/归档排除、范围/来源迟到、旧批注及上下文失效、个人记录/参考字段边界、取消/坏输出/指纹变化、独立版本、删章历史和磁盘重建恢复。UI 操作、真实 PDF 大容量、真实 provider 内容质量与学习效果分别验收，不互相替代。
