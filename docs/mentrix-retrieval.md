# 本机材料关键词检索

`learning/retrieval.mjs` 导出纯函数 `retrieveMaterialSources(records, query, options)`。它不读文件、不访问网络、不调用模型、不执行来源文本，也不承担鉴权。调用者须先按当前会话筛选 owner、所属工作区、存在且 ready 的来源；删除记录不能传入。这里不能替代 services 的来源版本/迟到写回检查。

```js
const sources = retrieveMaterialSources(authorizedReadyRecords, actualUserQuestion, {
  maxTotalChars: 20000, maxPerSourceChars: 6000, maxSources: 10,
});
```

输入记录为 `{id, collection, updatedAt, pages?:[{number,text}], text?}`；纯文本亦接受 `content`。非空 `pages` 优先，避免重复检索解析后的全文。使用集合名和 ID 区分来源，同名文件不会合并；同一记录的相关页在一个结果中聚合。重复的同集合/ID记录只考虑首次，计入 skippedRecords。返回值只复制规定字段，不夹带其它用户或文件元数据。

输出是 `[{id,collection,updatedAt,text,sourcePages,retrieval}]`。`sourcePages` 来自实际 `page.number`，支持数值或短页码标签；没有页码的纯文本返回空数组。`retrieval.excerpts` 的 `start/end` 是相应原始页文本或纯文本的 UTF-16 起止偏移，`end` 不包含在内。多个不连续片段用明确的省略标记连接，标记也计入输出预算。原文中的 HTML、脚本、指令保持普通文本，显示时仍须使用安全文本/净化后的 Markdown；模型侧仍须将引用视为不可信资料。

只对问题使用 `Intl.Segmenter` 中英文分词、大小写/兼容字符归一化及小型停用词表。正文按 1000 字符窗口、160 字符重叠扫描，用命中词数及有限词频评分；每源保留最多 16 个候选。稳定排序先按分数，再按输入来源、页序和字符位置，无随机数或时间依赖。这是关键词子串检索，不提供向量语义、同义词推断、OCR、网页研究或正确性保证；未抽取到的扫描图像文字也无法命中。

默认输出最多 10 源、每源 6000 字符、合计 20000 字符。调用选项只能缩小这些上限。单次问题最多 6000 字符、32 个不同检索词。硬扫描范围为最多 256 条记录、每条前 500 个页记录、合计 4000000 个原文字符；通过均分剩余扫描额度，优先让短来源完整进入扫描，避免第一份大文件吞尽预算。每源按原页序扫描其获分配的前缀，超预算的后部可能漏检。字符预算均按 JavaScript UTF-16 单元计算，而非字节或模型 token。

结果中的 `retrieval.scannedChars/sourceChars/sourceCharsKnown/scanTruncated` 表示该来源的实际扫描范围；页数过限时 `sourceChars` 只是已考虑页的字符数，`sourceCharsKnown:false`。`coverage` 只有全部来源文字进入输出时才为 `full`，否则为 `partial`，与回答质量或知识掌握无关。`outputTruncated` 表示来源未完整输出。每条结果的 `request` 同时报告全局扫描预算、遗漏记录/来源和输出截断；`queryTermsTruncated` 表示问题词超过限制。界面与引用清单应保留这些限制，不得把完整扫描或局部命中描述成模型完整阅读所有材料。

扫描范围内没有关键词命中时，有限返回每源至多 1000 字符开头概要，明确设 `fallback:true`、`fallbackReason:no-keyword-match-in-scanned-text`；问题为空或仅停用词则为 `no-searchable-query-terms`。回退不是相关性证据。无有效材料直接返回 `[]`，调用层应提示没有可检索来源，不能伪造引用。

非法输入抛出带 `status:400` 的错误，公开代码为 `RETRIEVAL_INVALID_RECORDS`、`RETRIEVAL_INVALID_QUERY`、`RETRIEVAL_QUERY_TOO_LONG`、`RETRIEVAL_INVALID_OPTIONS`。重新生成回答时必须取目标回答前最近的一条用户问题，不能把模型旧回答当检索问题；入模后仍需保存来源 ID、updatedAt、页码和 coverage，并在异步写回前重新校验 owner/父级/版本。

验证命令：`node --test tests/study-retrieval.test.mjs`。10 项纯合成测试覆盖文件末尾关键词、中文、真实页码、同名不同 ID、多页聚合、输出/扫描硬预算、明确概要回退、稳定顺序和错误边界；未调用真实模型或 Mentrix 服务。HTTP 集成由 services 的 owner/ready 过滤、实际用户问题与 sourceVersions 检查共同完成，纯函数通过不等于集成已通过。
