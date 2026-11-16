# 课程目录图与个人AI复习摘要

`learning/course-tools.mjs`只准备本人当前课程的目录与有来源输入，并校验模型输出。它不读文件、环境变量或密钥，不访问网络、不调用模型、不写store，也不会自己拼出“AI摘要”。HTTP鉴权、任务、模型调用、预算、持久化、取消及下载由学习服务负责；短信与支付继续保持未配置。

## 公开纯函数

```js
import {
  buildKnowledgeAtlas,
  createCourseSnapshot,
  validateSummaryOutput,
} from './learning/course-tools.mjs';

const atlas = buildKnowledgeAtlas(state, user, textbookId, { chapterId });
const snapshot = createCourseSnapshot(state, user, textbookId, {
  chapterIds: [], // 空数组表示当前全部活动章节
  goal: '结合我的笔记与作答安排复习',
});
// raw必须来自真正模型调用；此处没有本地成功模板。
const accepted = validateSummaryOutput(raw, snapshot);
```

`user`必须有已认证的 `id`。未知/其他用户教材及未知、已归档、其他教材章节返回404。`chapterIds`最多100个，不接受重复或null；goal为最多1000字符的字符串，显式null不视为空目标。只有缺省字段使用默认值。

### 目录图

返回 `{schema,textbook,nodes,edges,counts,scope,coverage}`，schema为 `knowledge-atlas/v1`。

- 节点id均为教材、章节、知识点的真实持久ID；kind分别为textbook、chapter、knowledgePoint。节点提供title、textbookId，以及适用的parentId、chapterId、sourceAnchor、progress和counts。
- 边字段为source、target和kind:'contains'，source/target分别是真实父/子ID；仅表示实际目录包含关系，不生成先修、语义或因果关系。
- 全量或单章筛选都保留必要的教材→章节→知识点父链。sourceAnchor来自当前本人文件及合法页范围，缺失来源不造页码；节点会标sourceAvailable。
- counts为chapters、knowledgePoints、notes、attempts、selfMarkedMastered。notes计当前有效批注（包括纯划线）；attempts计本人当前来源题组的实际作答；mastered仅表示本人自标，不是能力测定。

最多呈现100章、1000知识点；超限在coverage.partial和省略数量中说明，可按单章继续查看。目录中跨类型持久ID冲突返回409，不通过新造ID掩盖冲突。

### 有来源的个人快照

schema为 `personal-course-snapshot/v1`，返回以下字段：

| 字段 | 内容 |
| --- | --- |
| textbook | 本人教材的id、title |
| scope | textbookId、实际选择的chapterIds、trim后的goal |
| sources | 当前本人知识点的id、chapterId、title、revision、sourceAnchor、text，以及sourceChars/providedChars/truncated |
| personalTraces.notes | 当前有效的本人批注文字与选文；包含来源类型和真实知识点ID |
| personalTraces.progress | 本人自标状态，recorded区分实际记录与默认未开始 |
| personalTraces.exercises | 每知识点最新当前来源题组的公开题干/选项，最多提供其中2题并明确省略数 |
| personalTraces.attempts | 对已提供题目的本人最近作答、当前合法评分反馈及其人工复核标志；不拿分数推断掌握程度 |
| coverage | 输入范围、数量、文本与记录截断情况 |
| fingerprint | 规范化SHA-256，用于生成提交及历史current/stale判断 |

归档、外人、旧来源题组/批注不进入输入。知识点必须能对应本人当前教材文件及合法来源页，已删除或来源不明的正文排除；选区没有可用正文返回409 SUMMARY_SOURCE_EMPTY。课题对话笔记另外检查所有知识点引用仍处于当前关联教材范围；有workshopScope快照时，同时核对scopeRevision和排序后的完整关联集合，避免移除后重新关联时恢复旧上下文。

**任何题组的标准answer、rubric、explanation都不复制给摘要模型，即使本人已reveal。** 参考答案/解析区的批注也排除；本人提交的回答与已经可见的评分建议按个人记录传入。学习者自己写出的内容可能与教材事实相同，这不等于读取了隐藏答案字段。

## 输入预算与coverage

最多48个正文来源，正文字符合计≤24000；个人迹线JSON≤10000；完整快照JSON严格小于52000字符，为服务端提示词和输出格式保留余量。高元数据或转义开销会进一步缩小来源数量。每个字符串的截断和记录省略均保留范围说明；不是悄悄宣称读完了整本教材。

coverage字段固定为：

```text
partial
selectedChapterCount / candidateKnowledgePointCount
includedSourceCount / omittedSourceCount / unavailableSourceCount
providedSourceChars / sourceTextTruncated / chapterScopeTruncated
personalTraces:
  included、omitted: notes / progress / exercises / attempts
  truncated: notes / exercises / attempts
  selection: exerciseSets / attempts / questionsPerExercise
  protectedNotesOmitted / staleNotesOmitted / noteScanTruncated / partial
```

个人记录按类别独立留预算，批注最多扫描500条；题目、省略的其他题、长答案或长反馈出现截断时，personalTraces.partial和顶层partial均为true。selection明确仅取每知识点最新当前题组、每个已纳入题组最近两次作答、每题组最多2题；被跳过的同来源旧题组和第3次以后作答计入omitted并标partial，不声称提供完整学习历史。受保护答案批注、旧来源记录按策略排除，不能把它们当作已经提供的模型依据。

## 指纹与真实模型摘要

指纹覆盖实际范围与goal、提供来源的完整正文摘要/标题/修订/页锚、纳入批注、用户自标、题目公开内容、本人答案以及当前评分版本/反馈。完整文本的后半段虽因预算未提供，发生修订仍会使引用该来源的摘要过期；用户记录顺序重排和其他用户记录变化不改变指纹。不会把标准答案字段放入指纹来形成猜答案通道。

服务端在模型完成后、提交事务内重算同一范围；不一致应拒绝迟到结果。读取历史产物时也用相同范围重算并标stale，不覆盖旧版本或偷偷换用最新范围：

```js
createCourseSnapshot(state, user, artifact.textbookId, {
  chapterIds: artifact.scope.chapterIds,
  goal: artifact.scope.goal,
}).fingerprint === artifact.traceFingerprint;
```

模型必须返回且只返回 `{title,content,sourceIds}` JSON，sourceIds逐字使用本次snapshot.sources中实际存在的知识点ID，不能使用章节标题、页码、个人记录ID或未提供来源。标题最多160字符，正文最多20000字符；坏JSON、空内容、重复/未知引用及额外“已掌握”之类结构字段会被拒绝。校验成功仍强制 `requiresHumanReview:true`，格式与引用校验不证明所有自然语言主张成立。

摘要应结合已记录的本人笔记、作答与自标提出待复核复习建议，不虚构学生、学习效果或客观能力结论。它由真实模型流程生成；无模型或任务失败时由服务明确失败，不使用本模块的本地拼接结果伪装成功。

## 本模块验证

`node --test tests/study-course-tools.test.mjs`使用合成state与纯函数，覆盖真实ID/包含边、owner与章过滤、无隐藏答案输入、显式reveal仍不带答案、源/笔记/自标/评分指纹变化、外人和排列不扰动、大转义输入预算、内部截断partial、关联范围移除/重加及严格模型JSON。没有真实账号、环境变量读取、模型调用或网络。HTTP任务取消与提交冲突由服务集成测试和独立复核另行验证。
