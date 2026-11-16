> 公开整理版：移除本机绝对路径。下文的 evidence/ 与 REA Evidence ID 指向本地原始审计资料，未随公开仓库上传；不包含账号会话、第三方原始脚本或可运行的 Mentrix 克隆。

# M04：Mentrix 浏览器 API、数据契约与行为复现规格

producer: `/root/reverse_critic`；reviewer: `/root`；run: MENTRIX-REA-20261116；日期：2026-11-16（Asia/Shanghai）。状态：PRODUCED / 静态客户端契约，不是服务端已验证接口文档。

## 输入、方法与证据级别

唯一业务源码为 `corpus-source/mentrix/public-bundle/index-rKI-61y3.js`，2,979,827 bytes，SHA-256 `a46069288fd0841733d470ca5510fdb463e1dcd70458e44b1e2edcb62eecf541`。来源清单 v3 的摘要为 `e6a49f844af859516b6bf6b169d35c3c24df87bb9e27f8c0dacbcd6d8276861f`。

本任务使用本地 Babel parser 仅解析交付脚本为 AST，再读取节点、函数、对象字面量和调用关系；没有 import/执行目标脚本，没有调用业务接口，没有读取 Cookie、localStorage 或账号数据。共枚举到 **123 处 `_e.get/post/put/patch/delete` AST 调用点**，另识别 fetch/V1/EventSource 及资源 SDK 路径。这是特定 client 别名的调用点数量，不等于 123 个唯一接口，也不是全服务端 API 分母。123=79个TemplateLiteral首参＋42个StringLiteral首参＋2个Identifier首参；只匹配字面首参的regex会得到121。两处额外项是upload的`_e.post(a,i,...)`（byte891531）及动态音频/资源请求`Fet`的`_e.get(e,...)`（byte2448624）。

补充运行时旁证为协调者实际匿名GET的 `evidence/public-api/public-config.json`，时间2026-11-16 12:51:32+08:00，HTTP200且success=true。本文对该份保存结果独立核读，没有再次发起请求。其`version:"1.0.0"`是业务配置字段，不当作React、后端或构建工具版本。

以下定位统一为该文件 **0-based UTF-8 byte offset**，由 `Buffer.byteLength(source.slice(0, node.start))` 或 UTF-8 前缀长度计算；Babel 的原始 start 是 UTF-16，未将其冒充 byte offset。区间是定位附近片段的范围，不表示恢复了原始源文件/行号。文中“客户端事实”表示代码确有此分支；“兼容实现建议”表示可复现设计；真实服务端校验、运行效果、模型质量和未触发流程仍需网络/运行时证据。

## 共享客户端与认证状态机

| 位置 | 客户端事实 | 独立实现需要保留的行为 |
|---|---|---|
| 792723、845038、845988 | 本构建配置 API base `/api/v1`；Axios 默认 JSON、120s timeout、withCredentials=true；响应 interceptor 返回 response.data | 业务 wrapper 得到的是包裹体而非完整 AxiosResponse；二进制/文本接口单独处理。 |
| 843899–845008 | 排除列表 `/auth/send-otp`、`/auth/login`、`/auth/refresh`、`/config/public` 按 includes 匹配；其他请求从认证 store 注入 Bearer | 这是代码的排除匹配语义，不推断服务端公开/私有权限表；`/auth/login-password` 会被 `/auth/login` 子串匹配。 |
| 842609–843330 | refresh 支持可选 getRefreshToken 回调；本构建未提供该回调，所以发送无显式 JSON body 的 POST `/auth/refresh`；成功期望 `success && data`，消费 access_token/expires_in | 用并发互斥和等待队列保证同时失效只刷新一次；失败拒绝所有等待者。不能仅以 HTTP 200 判定刷新成功。Cookie 的实际名称、属性及 refresh token 内容未知。 |
| 844108–845008 | 普通请求遇401且不是排除URL，设置 `_retry`，刷新后重放一次；刷新失败 logout；503最多重试3次，等待 min(retry-after秒, 2^retry秒)；429可读取 retryAfter | 本地测试验证单次重放、并发刷新、取消、503退避及最终错误。服务端幂等性未知，不能据自动重试推断每个POST可安全重放。 |
| 843331–843879 | V1 流式 fetch 包装器注入 Bearer，401刷新后再 fetch 一次；没有自动流断点续传或 offset replay | 流式业务 store 另做重新连接；普通 Axios 的 withCredentials 不自动证明所有 fetch 都带 credentials。 |
| 800005、909168–910066 | auth-storage 静态代码使用 localStorage adapter；持久化 accessToken、user、expiresAt、isAuthenticated，剔除 user 的 payment_enabled/wechat_pay_enabled；expiresAt=now+expires_in×1000；checkAuth提前30s视作需刷新 | 此处描述交付代码，不表示读取了真实存储。logout清理查询缓存、生成流、阅读位置等用户数据。实际服务器会话/撤销策略未知。 |
| 851058、865015、899936 | 多个 wrapper 消费 `{success,data,message,error_code}`，有的要求 data非空，有的允许null；content/download接口返回原始文本/blob | “统一JSON envelope”是多数wrapper期望，不能将所有资源接口强行包进JSON；字段类型以实际记录再细化。 |

认证接口的请求构造可直接恢复（1193204–1194115）：

| method/path（均加 `/api/v1`） | 客户端构造的 body/query |
|---|---|
| POST /auth/send-otp | phone,purpose；若有图形验证结果，附 captcha_lot_number,captcha_output,captcha_pass_token,captcha_gen_time |
| POST /auth/login | phone,code,agreed_terms（默认false）,device_info（浏览器/OS字符串） |
| POST /auth/login-password | phone,password,device_info |
| GET /auth/check-nickname | query nickname |
| POST /auth/register | phone,code,nickname,password,invite_code |
| POST /auth/refresh、/auth/logout | wrapper不传显式body |
| GET/PUT /users/me | 更新对象按调用方；已确定 teaching_prompt_style、密码修改另走专门接口 |
| POST /auth/reset-password | phone,code,new_password |
| POST /users/me/change-password | old_password,new_password（2604572）；新密码界面校验8–32位、同时有大小写字母与数字，不是可任意选择一项的radio规则 |

## 两条产品主流程及状态边界

**教材学习链**：选择PDF→校验文件→申请上传credentials→对象存储直传或降级multipart→complete→识别目录/知识结构→按章节运行ocr/extract/prep→知识点讲解与追问→练习/答案/评分→批注与笔记→章节产物/讲义导出。这是前端组合出来的可复现流程；服务器中“解析、萃取、备课”各自算法仍未知。

**课题链**：创建课题name/description→依次上传可选材料→课题内阅读材料/触发OCR→指定关联教材范围→创建或选择conversation→发送富文本/图片/文件引用消息→消费消息和工具进度事件→取消/重新生成→保留对话、文件预览、批注。创建失败/卸载的cleanup分支会删除未完成的新课题（1136506附近）；本任务没有执行该分支。

| 领域 | 恢复的接口族与关键字段 | 来源byte |
|---|---|---|
| 教材 | GET /textbooks；PUT /textbooks/layout（调用方对象）；GET/DELETE/PATCH /textbooks/{id}，rename body `{new_name}` | 891195–892462 |
| 上传 | POST /textbooks（FormData.file，query client_upload_id/extraction_mode）；POST /textbooks/upload-credentials；POST /textbooks/{id}/complete | 891531–891836、1944153 |
| PDF/OCR | GET /textbooks/{id}/ocr；POST /ocr/retry；POST /pdf 返回blob；POST /pdf-url 消费 data.url | 891932–892173 |
| 目录/知识结构 | POST /toc/auto-detect；GET /agent/knowledge-graph/status；POST /agent/toc；GET/POST /agent/knowledge-graph；GET /extraction/quote、/textbooks/extraction/quote-estimate?page_count、/textbooks/toc/quote | 892462、1120762–1121449 |
| 章节批处理 | GET /textbooks/{id}/chapters/extraction-status；GET /chapters/batch-extract/quote?chapters=逗号列表；POST /batch-extract `{chapters}`；GET /batch-extract/{batch}；POST cancel | 1143984–1144700 |
| 章节流程 | POST /textbooks/{id}/chapters/{num}/flow `{stages}`；GET flow；GET flow/quote?stages=逗号列表；POST flow/cancel | 846209–847745 |
| 知识点 | GET /textbooks/{id}/agent/chapters/{num}/context、/plan；GET /agent/kp/{kp}/lesson（text）、/conversation、/lesson/metadata；POST teach（下文SSE） | 881174–881813、889111 |
| 章节产物 | GET /textbooks/{id}/chapters/{num}/artifacts、/textbooks/{id}/artifacts；POST /chapters/{num}/artifacts/{type}/generate `{language,force_low_material?}`；按artifact或run读取text/blob及run/events | 851248–852429 |
| 练习 | quote query mc/exp；create `{language,requested_mc,requested_exp}`；集合list/detail/cancel/resume；提交 `{attempt_id,answer}`；attempt详情；reveal；flag `{text}`；set/key | 865313–867028、871949、2466100 |
| 课题 | GET/POST /workshops；GET/PATCH/DELETE /workshops/{id}；create name/description；PATCH `{linked_textbook_ids}`；files FormData.file、删除、rename `{new_base_name}`、preview-url、OCR | 1133851–1135011、1136506、2852062 |
| 对话 | GET /workshops/{wid}/conversations；POST 同路径 `{container_type:"workshop",container_id:wid,api_format:"response_api"}`；GET /conversations/{cid}；PATCH title/persona/is_deleted；POST cancel | 900134–900976 |
| 行内图片 | legacy FormData.file；或upload-credentials `{size_bytes,mime_type}`→对象存储PUT→/{imageId}/complete `{mime_type}`；thumbnail GET | 897350–899300、901334 |
| 批注 | POST/GET /highlights（query textbook_id,kp_code）；DELETE/PATCH /highlights/{id}，note/color；notebook-open、jump-back埋点 | 2409509–2410066、2420678 |
| TTS | GET /tts/config；POST /tts/speak（fragments、language/context/streaming flag）；POST /tts/speak/metrics | 893740、2444630、2450370 |
| 导出 | POST /textbooks/{id}/exports `{kp_codes}`；GET /exports/active、/exports/{exportId}、/download；POST cancel | 2512035–2512468 |
| 文件夹 | GET/POST /textbook-folders；PATCH/DELETE /textbook-folders/{id}，name | 1127999–1128180 |
| 账户与配置 | GET /users/me/quota、/config/public；会员skus/topup-skus/credit-coefficients；orders创建/列表/详情/track；邀请码 mine/create | 1130030、1132913、1137733–1142976 |
| 反馈/公告 | feedbacks/create、mine?page/limit、detail、replies `{content,attachment_ids}`、upload-image；announcements?limit/offset及detail | 1131136–1132558 |

## 上传限制、目录/OCR 与轮询

教材校验 `kre` 位于约1940510：MIME=application/pdf **或**扩展名.pdf满足格式检查，文件上限 `300*1024*1024` bytes。界面写300MB，实际比较单位是MiB。上传组件`pYe`在1930064附近还声明默认maxSize=300,maxPages=3e3，并在19332xx渲染“不超过3000页”；2373568调用点提供“暂不支持加密PDF”提示。因此3000页有默认UI源码和代理观察旁证，但本地校验函数只检查格式/体积，不数页，服务器对3000页的强制执行边界未验证。

直传请求body为 `{filename:file.name,size_bytes:file.size,extraction_mode,client_upload_id}`（1944153）；刷新STS时附textbook_id。消费credentials字段 access_key_id/access_key_secret/security_token，以及bucket,region,endpoint,object_key,part_size；使用OSS SDK multipart/checkpoint/abort，完成后调用complete。短时网络/STS错误可走legacy上传fallback，业务错误不一概fallback（1942354–1944600）。这些是客户端接口约定，不包含实际凭据。事件流 `/textbooks/upload-events?client_upload_id=...&token=...` 监听 milestone、oss_done、complete、error（1941145），静态代码将access token放入query；共享HAR时必须移除该值。

目录侧 `bat`（2716200–2721400）消费process_step、complete、error；process_step仅显示chapter_id为空或toc的步骤，合并同一工具的执行/完成条目，拼接连续text/thinking。complete读取total_chapters。NO_TEXT_LAYER/CORRUPT_PDF转unavailable；连接失败后每3s轮询知识结构status；agent_status=ready再GET知识结构，failed显示error_message，unavailable根据agent_extraction_stage区分corrupt_pdf/scanned。不能把断开SSE等同服务器任务停止。

课题材料并非“任何短文档”：前端校验数组包含PDF、JPEG、PNG、text/markdown、text/plain；后两种还要求.md/.markdown扩展名，MD上限5MiB（28956xx）。页面和错误分支写PDF≤100页。**非MD容量存在代码分歧**：部分界面硬编码“单文件≤100MB”，`iht`默认30MiB，创建页实际取`publicConfig.workshop_material_max_mb ?? 30`并传入校验/选择器（2896037、2900xxx）。补充公开配置实测返回workshop_material_max_mb=30、workshop_material_max_count=10，因此当前配置驱动的非MD前端校验上限为30MiB，100MB文案与之不一致；不能将该配置观测等同服务器边界实测，亦不能将旧文案当通用硬规则。部分页面还有文件名包含over100即报页数错误的分支（2882775），它不是可靠的PDF本地页数解析证明。

课题文件OCR客户端状态为ocr_running/ocr_failed/ready等，运行时每3s刷新课题详情（11350xx）；PDF超过100页的错误文案和PAGE_COUNT_EXCEEDED契约见2843385。实际OCR精度、支持的扫描图质量及服务器重试机制未知。

## 讲解风格、个人化与练习答案

用户级 `teaching_prompt_style` 通过PUT /users/me保存，并由认证store user读取；default为中文解释、术语首次附原文；language_adaptive为中文讲述而专业术语保留英文；english为全英文简明讲解与考试术语。该设置全教材通用，接口body里不是虚构的model/prompt字段（2538950–2544700）。这些是产品说明与客户端保存契约，不能据此恢复服务器system prompt。

课题对话另有persona=default/exercise_explainer；后者文案是“步骤拆解＋关键概念回顾＋反思建议”。PATCH /conversations/{cid}更新persona，并做乐观更新/失败回滚（2829376–2830630）。不能把此persona与用户全局讲解风格合并成同一个字段。

练习生成类型mc/exp；请求 `{language,requested_mc,requested_exp}`。set状态白名单queued/generating/ready/partial/failed；attempt状态pending/grading/graded/failed（864xxx）。客户端先quote再下单/恢复，以set_id做流驱动。提交前生成attempt_id，并将answer内容签名；同一未完成答案重试复用attempt_id。mc answer=`{choice:number}`，exp answer=`{text:string}`；POST attempts返回pending/grading时轮询attempt，graded时取key/feedback；取消轮询并不等于服务器撤销评分（867361–873300）。

查看答案走POST reveal，返回data.key；批量GET set/key还原已作答/已揭示状态。EXERCISE_QUESTION_REVEALED、EXERCISE_ATTEMPT_IN_FLIGHT等代码有专门处理。flag请求 `{text}`。答案/评分的完整schema和服务端“看答案后是否允许再评分”策略需要响应样例，不能仅凭error枚举证明所有限制已上线。

## SSE 协议与恢复

流式请求通常为Accept:text/event-stream，写入型为POST JSON；H1通过TextDecoder累积、按换行读取event:/data:并逐条JSON解析（850277）。客户端消费的是“一条data行一条JSON”的约定，不应声称它实现了所有通用SSE多行data语义。

| 流 | 路径/方法与body | 客户端消费的事件与字段 |
|---|---|---|
| 章节流程 | GET /textbooks/{id}/chapters/{num}/flow/stream | snapshot{flow,stages,entries_by_stage}；stage；entry；run；ping忽略。stage keys为ocr/extract/prep；flow_id隔离旧流，seq去重。 |
| 章节产物 | GET /chapter-artifacts/{artifactId}/generation/stream | snapshot/stage/entry/run/ping；阶段read_materials/write_note/validate_repair/package_offline；stage含status、时间、tool_call_count/fix_count。 |
| 知识点教学 | POST /textbooks/{id}/agent/chapters/{num}/teach，`{kp_id,action,user_message?}` | queued{position}、queued_started、text_delta{content}、moderation_regenerating{attempt}、process_step、progress_generated、done{credits_consumed?}、error{message,error_code?}。start为已见调用action，其他action完整枚举需另核。 |
| 练习集合 | GET /textbooks/{id}/agent/kp/{kp}/exercises/{set}/stream | snapshot{set}、question{question,produced_mc,produced_exp}、terminal{status,set}；ping忽略。 |
| 课题对话 | POST /conversations/{cid}/messages，`{content,client_message_id,force_tools:array或null}`；regenerate=`{from_message_id,client_message_id}` | conversation.run.started{user_message_id}；message.delta{item_id,delta_text}；message.done{item}；item.added{item}；tool_running；tool_step；moderation.regenerating；error；aborted；title.delta/title.done/title.failed。 |
| 目录/知识结构 | GET /textbooks/{id}/agent/knowledge-graph/stream | process_step/complete/error；失败退到status轮询，见上节。 |

章节/产物/练习流以1/2/4/8/16秒退避、最多5次重连；章节流约45s无事件进入stalled再重连，带lastEventAt/lastContentAt、reconnected提示（854300–861790）。重连后消费snapshot恢复展示；没有看到以Last-Event-ID保证恰好一次投递的证据。终止404/认证刷新失败与可重试网络错误分开。应把“恢复UI流驱动”与“恢复服务器任务执行”分开实现。

课题对话store以item_id累积增量文本，工具输出item_type=function_call_output通过call_id清理对应streamingSteps；审查重生成时替换正在展示的助手文本；错误或完成后使conversationDetail查询失效再拉取真实记录。stop同时abort客户端和POST cancel；重生成为新的client_message_id，而不是续写同一网络连接（901334–909168）。工具名字/模型调用真实能力仍须运行时响应核对。

## 章节产物、数据实体与可兼容 DTO

产物列表由服务器返回`artifacts[]`，每项消费artifact_type/display_name/artifact_id/status/started_at/failure_reason/progress_summary/runs；前端没有恢复出可穷尽的artifact_type常量集合，不应编造“仅支持某几种文件”。可见UI称“学霸笔记”，材料来自该章已学讲义、追问、划线、批注。learnedKp<3弹低材料确认，强制生成发送force_low_material=true；这不是服务器minimum=3的证明（2929361–29394xx）。

展示状态not_generated/generating/ready/failed。run含run_id,status,finished_at,kp_count,duration_seconds,credits_charged,has_content,language，以及阶段与request_count/fix_count；存在历史run只读回看、按run读content/download。404/401/409加载异常区分gone/denied/load_failed；不能把旧run内容覆盖成最新run（851xxx、2911500附近）。

以下是**前端消费者可见的DTO字段，不是数据库表、完整OpenAPI或服务器类型保证**：

| 实体 | 已恢复字段或关系 | 证据byte |
|---|---|---|
| AuthSession/User | access_token,expires_in,user.id；user.teaching_prompt_style；isAuthenticated/expiresAt是前端状态 | 909168、2540687 |
| Textbook | textbook_id、agent_status、extraction_mode；list/detail及PDF/OCR/learning-progress关联 | 891195、892900、1189136 |
| KnowledgeGraph | points[],edges[],chapter_titles；point消费id/chapter/name_en；chapter plan消费teaching_sequence[].kp_id/order | 1163412、1189136、2529312 |
| ChapterFlow | flow_id,status,failure_reason,error_code,stages,entries_by_stage；阶段ocr/extract/prep | 854300–858000 |
| Artifact/Run | 上述artifact/run字段；归属textbook与chapter，content按artifact或run加载 | 851248–854900、2930xxx |
| ExerciseSet | set_id,kp_code,language,status,requested_mc/requested_exp,produced_mc/produced_exp,questions,failure_reason,created_at | 875895 |
| Question/Attempt/Key | qid,type(mc/exp)；attempt_id,status,answer,key；key列表含latest_attempt_id/status并与qid关联 | 867361–873300 |
| Workshop | workshop_id,name,description,files[],linked_textbook_ids；缺省null关联范围与显式[]不等价，UI会将null补成当前可用教材集合 | 1136506、2836035、2852062 |
| WorkshopFile | file_id,original_filename,file_type,is_scanned,agent_status；preview/OCR；其他元数据需响应 | 2836035、2843385 |
| Conversation/Item | id,title,persona,messages[]；item{id,item_type,payload,created_at}；message payload有role/content；tool输出call_id | 900200–909168 |
| Highlight | id,textbook_id,kp_code,source,exact,prefix,suffix,position_hint,section_heading,color,note；source相关字段见下节 | 2409509–2421100 |
| TTSResponse | stream_url或audio_url、task_id、primary_language、cache_hit；时间/片段索引的完整schema仍需响应 | 2444630、2450500 |
| Quota/Membership | trial_credits_remaining与trial_credits_granted是两个字段；会员权益展示monthly_credits/textbook_limit/workshop_create_limit/workshop_material_limit，publicConfig可提供容量 | 2594409、2646073、2900xxx |
| Order/Feedback | order有status（fulfilled/paid/closed/refunded终止轮询）；feedback请求feedback_type/title/content/page_url/device_info/attachment_ids | 1138023、1139401、2632363 |

试用赠送数由trial_credits_granted渲染，账户余额由trial_credits_remaining渲染（2594409）；源码此处没有“所有账号固定赠送500”常量，不能把单账号余额或某一次页面值推广为全站通用权益。

## 批注锚点与文本改版恢复

新增payload：`{textbook_id,kp_code,exact,prefix,suffix,position_hint,section_heading,color,...sourceMetadata}`（2420678）。prefix/suffix各取最多32个JS字符串单位；**position_hint记录exact在当前region中第几次出现，非字符绝对偏移**（2412197）。会跳过KaTeX隐藏mathml和data-hl-skip文本；先将DOM文字构成索引，再把匹配的文本位置映射回Range。

恢复算法：查全部exact匹配；唯一匹配直接用；多匹配先以prefix后缀和suffix前缀过滤；仍不唯一时用position_hint对应项，否则首项；找不到exact则返回null，不凭空“恢复”。因此原文实质改写/删除后并不保证批注可恢复，不能写成跨版本语义锚定或永久精准定位。

source=lesson时定位讲义区域；conversation带message_index/message_timestamp；exercise带exercise_set_id/exercise_qid/exercise_block及可选exercise_attempt_id（2416217）。exercise block白名单stem/choice_explanation/solution/reference_answer/feedback见2409489。修改note/color使用PATCH，删除和新增都有乐观更新/失败回滚。新建先用tmp id画Range，成功后rebind服务器id；失败移除临时标记（2410271、2420678）。

## TTS 分块、播放状态与中断

`Oet`默认切块目标3000、总量上限30000，计数为JS字符串.length（UTF-16 code units），非字节数、词数或Unicode字素数（2441399–2444xxx）。文本优先在段落双换行拆，再取末个中英文句末标点，再看后半部分空格，否则硬截；非text片段不在内部拆开，故长非text片段可让单块超过3000目标，不能称每块硬上限3000。fragment包括type/content，完整类型集合与音频对齐响应需继续核。

调度器先等第0块成功，播放时预取下一块；每块请求使用AbortSignal.timeout(30000)，状态pending/ready/failed，支持释放已播音频，后续块失败时可跳过而非无限重试（2442xxx–2445xxx）。POST speak附fragments、preferred_language=auto及textbook_id/kp_id/workshop_id/conversation_id/message_id上下文；响应优先stream_url，否则audio_url。不能由URL命名推断使用哪家TTS或其流式编码。

播放器idle→preparing→playing；页面隐藏会pause，resume仅在已有paused audio上play；stop会abort请求和所有调度块、暂停并清空音频、取消RAF、移除高亮/可见性监听、回idle（2450500–24567xx）。**这是内存中的暂停/继续，不是浏览器刷新或跨设备持久断点续播**。新play先stop旧任务，避免双音轨。metrics发送首字节延迟、播放流总时长、字符量、语言、cache_hit及上下文，失败静默。

## 待验证边界与实现验收

尚未获得完整登录后HAR或原始DOM/截图/网络事务与各业务调用的对照。在线浏览器代理的自然语言摘要只能作旁证；错报路由、页数/容量、试用权益、表单类型必须与交付代码隔离。服务端源码、数据库、RAG/检索策略、模型/提示词、计费扣减精度、OCR/讲解/评分质量仍未知。

兼容实现的最低验收应覆盖：并发401只刷新一次且退出清缓存；上传取消/直传降级/complete后重新取状态；目录SSE断开转轮询；章节stage与run身份去重；练习attempt重试不重复提交、答案恢复；课题范围null与[]区别；对话增量/工具事件/取消与重生；批注重复文本和正文改版失配；TTS短文/长文/超限/首块失败/后块失败/隐藏暂停/stop清理；导出历史run和当前run不串用。上述仅为拟议验收，未在原站点实际执行。

## 附录：123处共享 API 调用点

下表由AST直接枚举，保留原最小化函数名与实参表达式。e/t/n等是局部参数，不是账号/业务实际值。所有路径默认继承`/api/v1`；流式和图片直传另见正文。这里不把静态调用候选升级为服务器确认接口。

| # | function | method / call expression | UTF-8 byte |
|---|---|---|---|
| C001 | X5e | POST — ``_e.post(`/textbooks/${e}/chapters/${t}/flow`,{stages:n},{timeout:15e3})`` | 847056 |
| C002 | Q5e | GET — ``_e.get(`/textbooks/${e}/chapters/${t}/flow`,{timeout:15e3,signal:n?.signal})`` | 847263 |
| C003 | Z5e | GET — ``_e.get(`/textbooks/${e}/chapters/${t}/flow/quote`,{params:{stages:n.join(",")},timeout:15e3,signal:r?.signal})`` | 847395 |
| C004 | J5e | POST — ``_e.post(`/textbooks/${e}/chapters/${t}/flow/cancel`,void 0,{timeout:15e3})`` | 847639 |
| C005 | i3e | GET — ``_e.get(`/textbooks/${e}/chapters/${t}/artifacts`,{signal:n?.signal})`` | 851248 |
| C006 | s3e | GET — ``_e.get(`/textbooks/${e}/artifacts`,{signal:t?.signal})`` | 851368 |
| C007 | o3e | GET — ``_e.get(`/chapter-artifacts/runs/${e}`,{timeout:15e3,signal:t?.signal})`` | 851474 |
| C008 | a3e | GET — ``_e.get(`/chapter-artifacts/runs/${e}/events`,{timeout:15e3,signal:t?.signal})`` | 851596 |
| C009 | l3e | POST — ``_e.post(`/textbooks/${e}/chapters/${t}/artifacts/${n}/generate`,r.forceLowMaterial?{force_low_material:!0,language:r.language}:{language:r.language},{timeout:15e3,signal:r.signal})`` | 851729 |
| C010 | u3e | GET — ``_e.get(`/chapter-artifacts/${e}/content`,{responseType:"text",timeout:2e4,signal:t?.signal})`` | 852033 |
| C011 | d3e | GET — ``_e.get(`/chapter-artifacts/${e}/download`,{responseType:"blob",timeout:6e4,signal:t?.signal})`` | 852163 |
| C012 | h3e | GET — ``_e.get(`/chapter-artifacts/runs/${e}/content`,{responseType:"text",timeout:2e4,signal:t?.signal})`` | 852294 |
| C013 | f3e | GET — ``_e.get(`/chapter-artifacts/runs/${e}/download`,{responseType:"blob",timeout:6e4,signal:t?.signal})`` | 852429 |
| C014 | U3e | GET — ``_e.get(`${Aa(e,t)}/exercises/quote`,{params:{mc:n,exp:r},timeout:15e3,signal:i?.signal})`` | 865412 |
| C015 | q3e | POST — ``_e.post(`${Aa(e,t)}/exercises`,n,{timeout:15e3,suppressQuotaWall:!0})`` | 865562 |
| C016 | G3e | GET — ``_e.get(`${Aa(e,t)}/exercises`,{timeout:15e3,signal:n?.signal})`` | 865711 |
| C017 | fk | GET — ``_e.get(`${Aa(e,t)}/exercises/${n}`,{timeout:15e3,signal:r?.signal})`` | 865838 |
| C018 | K3e | POST — ``_e.post(`${Aa(e,t)}/exercises/${n}/cancel`,void 0,{timeout:15e3})`` | 865963 |
| C019 | Y3e | POST — ``_e.post(`${Aa(e,t)}/exercises/${n}/resume`,void 0,{timeout:15e3,suppressQuotaWall:!0})`` | 866079 |
| C020 | Z3e | POST — ``_e.post(`${Aa(e,t)}/exercises/${n}/questions/${r}/attempts`,i,{timeout:15e3,suppressQuotaWall:!0})`` | 866382 |
| C021 | AX | GET — ``_e.get(`${Aa(e,t)}/exercises/attempts/${n}`,{timeout:15e3})`` | 866563 |
| C022 | J3e | POST — ``_e.post(`${Aa(e,t)}/exercises/${n}/questions/${r}/reveal`,void 0,{timeout:15e3})`` | 866708 |
| C023 | eAe | POST — ``_e.post(`${Aa(e,t)}/exercises/${n}/questions/${r}/flag`,i,{timeout:15e3})`` | 866880 |
| C024 | tAe | GET — ``_e.get(`${Aa(e,t)}/exercises/${n}/key`,{timeout:15e3,signal:r?.signal})`` | 867028 |
| C025 | getChapterContext | GET — ``_e.get(`/textbooks/${e}/agent/chapters/${t}/context`)`` | 881174 |
| C026 | getChapterPlan | GET — ``_e.get(`/textbooks/${e}/agent/chapters/${t}/plan`,{signal:n?.signal})`` | 881252 |
| C027 | getLessonMd | GET — ``_e.get(`/textbooks/${e}/agent/kp/${t}/lesson`,{responseType:"text",transformResponse:[i=>i],validateStatus:i=>i===200,signal:n?.signal})`` | 881435 |
| C028 | getConversation | GET — ``_e.get(`/textbooks/${e}/agent/kp/${t}/conversation`,{signal:n?.signal})`` | 881691 |
| C029 | getLessonMetadata | GET — ``_e.get(`/textbooks/${e}/agent/kp/${t}/lesson/metadata`,{signal:n?.signal})`` | 881813 |
| C030 | getList | GET — ``_e.get("/textbooks",{signal:e?.signal})`` | 891195 |
| C031 | updateLayout | PUT — ``_e.put("/textbooks/layout",e)`` | 891251 |
| C032 | getDetail | GET — ``_e.get(`/textbooks/${e}`)`` | 891294 |
| C033 | upload | POST — ``_e.post(a,i,{headers:{"Content-Type":"multipart/form-data"},suppressQuotaWall:!0,timeout:6e5,onUploadProgress:c=>{if(c.total&&t){const u=Math.round(c.loaded*100/c.total);t(u)}}})`` | 891531 |
| C034 | getUploadCredentials | POST — ``_e.post("/textbooks/upload-credentials",e,{suppressQuotaWall:!0,_retryCount503:3})`` | 891735 |
| C035 | completeUpload | POST — ``_e.post(`/textbooks/${e}/complete`,null,{suppressQuotaWall:!0,timeout:6e5})`` | 891836 |
| C036 | getOcrStatus | GET — ``_e.get(`/textbooks/${e}/ocr`,{signal:t?.signal})`` | 891932 |
| C037 | retryOcr | POST — ``_e.post(`/textbooks/${e}/ocr/retry`,null,{_retryCount503:3})`` | 891993 |
| C038 | getPDF | POST — ``_e.post(`/textbooks/${e}/pdf`,null,{responseType:"blob",timeout:18e4})`` | 892076 |
| C039 | getPDFUrl | POST — ``_e.post(`/textbooks/${e}/pdf-url`)`` | 892173 |
| C040 | getLearningProgress | GET — ``_e.get(`/textbooks/${e}/learning-progress`)`` | 892249 |
| C041 | deleteTextbook | DELETE — ``_e.delete(`/textbooks/${e}`)`` | 892323 |
| C042 | renameTextbook | PATCH — ``_e.patch(`/textbooks/${e}`,{new_name:t})`` | 892386 |
| C043 | autoDetectTOC | POST — ``_e.post(`/textbooks/${e}/toc/auto-detect`,null,{timeout:1e4})`` | 892462 |
| C044 | getConfig | GET — ``_e.get("/tts/config")`` | 893740 |
| C045 | synthesize | POST — ``_e.post("/tts/speak",e,{signal:t})`` | 893780 |
| C046 | KAe | GET — ``_e.get(`/conversations/${e}`,{signal:t})`` | 900134 |
| C047 | NX | POST — ``_e.post(`/conversations/${e}/cancel`,{},{signal:t})`` | 900251 |
| C048 | YAe | GET — ``_e.get(`/workshops/${e}/conversations`,{signal:t})`` | 900380 |
| C049 | XAe | POST — ``_e.post(`/workshops/${e}/conversations`,{container_type:"workshop",container_id:e,api_format:"response_api"},{signal:t})`` | 900512 |
| C050 | QAe | PATCH — ``_e.patch(`/conversations/${e}`,{title:t},{signal:n})`` | 900712 |
| C051 | ZAe | PATCH — ``_e.patch(`/conversations/${e}`,{persona:t},{signal:n})`` | 900844 |
| C052 | JAe | PATCH — ``_e.patch(`/conversations/${e}`,{is_deleted:!0},{signal:t})`` | 900976 |
| C053 | getExtractionStatus | GET — ``_e.get(`/textbooks/${e}/agent/knowledge-graph/status`,{signal:t?.signal})`` | 1120762 |
| C054 | getExtractionQuote | GET — ``_e.get(`/textbooks/${e}/extraction/quote`,{signal:t?.signal})`` | 1120862 |
| C055 | triggerExtraction | POST — ``_e.post(`/textbooks/${e}/agent/knowledge-graph${t?"?force=true":""}`,void 0,{suppressQuotaWall:n?.suppressQuotaWall})`` | 1120951 |
| C056 | getExtractionEstimate | GET — ``_e.get(`/textbooks/extraction/quote-estimate?page_count=${e}`,{signal:t?.signal})`` | 1121098 |
| C057 | getTocQuote | GET — ``_e.get("/textbooks/toc/quote",{signal:e?.signal})`` | 1121195 |
| C058 | triggerTocExtraction | POST — ``_e.post(`/textbooks/${e}/agent/toc`)`` | 1121269 |
| C059 | getKnowledgeGraph | GET — ``_e.get(`/textbooks/${e}/agent/knowledge-graph`,{signal:t?.signal})`` | 1121331 |
| C060 | listFolders | GET — ``_e.get("/textbook-folders",{signal:e?.signal})`` | 1127999 |
| C061 | createFolder | POST — ``_e.post("/textbook-folders",{name:e})`` | 1128062 |
| C062 | renameFolder | PATCH — ``_e.patch(`/textbook-folders/${e}`,{name:t})`` | 1128120 |
| C063 | deleteFolder | DELETE — ``_e.delete(`/textbook-folders/${e}`)`` | 1128180 |
| C064 | getMyQuota | GET — ``_e.get("/users/me/quota",{signal:e?.signal})`` | 1130030 |
| C065 | list | GET — ``_e.get("/announcements",{params:{limit:e,offset:t},signal:n?.signal})`` | 1131136 |
| C066 | getDetail | GET — ``_e.get(`/announcements/${e}`,{signal:t?.signal})`` | 1131234 |
| C067 | uploadImage | POST — ``_e.post("/feedbacks/upload-image",t,{headers:{"Content-Type":"multipart/form-data"}})`` | 1132195 |
| C068 | createFeedback | POST — ``_e.post("/feedbacks",e)`` | 1132312 |
| C069 | getMyFeedbacks | GET — ``_e.get("/feedbacks/mine",{params:{page:e,limit:t},signal:n?.signal})`` | 1132376 |
| C070 | getFeedbackDetail | GET — ``_e.get(`/feedbacks/${e}`,{signal:t?.signal})`` | 1132481 |
| C071 | createReply | POST — ``_e.post(`/feedbacks/${e}/replies`,{content:t,attachment_ids:n})`` | 1132558 |
| C072 | getPublicConfig | GET — ``_e.get("/config/public",{signal:e?.signal})`` | 1132913 |
| C073 | HOe | GET — ``_e.get("/workshops",{signal:e})`` | 1133851 |
| C074 | WOe | GET — ``_e.get(`/workshops/${e}`,{signal:t})`` | 1133964 |
| C075 | UOe | POST — ``_e.post("/workshops",e,{signal:t})`` | 1134078 |
| C076 | sJ | PATCH — ``_e.patch(`/workshops/${e}`,t,{signal:n})`` | 1134191 |
| C077 | oJ | DELETE — ``_e.delete(`/workshops/${e}`,{signal:t})`` | 1134300 |
| C078 | aJ | POST — ``_e.post(`/workshops/${e}/files`,r,{headers:{"Content-Type":void 0},timeout:6e5,signal:n})`` | 1134445 |
| C079 | qOe | DELETE — ``_e.delete(`/workshops/${e}/files/${t}`,{signal:n})`` | 1134606 |
| C080 | GOe | PATCH — ``_e.patch(`/workshops/${e}/files/${t}`,{new_base_name:n},{signal:r})`` | 1134725 |
| C081 | KOe | GET — ``_e.get(`/workshops/${e}/files/${t}/preview-url`,{signal:n})`` | 1134872 |
| C082 | YOe | POST — ``_e.post(`/workshops/${e}/files/${t}/ocr`,{},{signal:n})`` | 1135011 |
| C083 | getSkus | GET — ``_e.get("/membership/skus",{signal:e?.signal})`` | 1137733 |
| C084 | getTopupSkus | GET — ``_e.get("/membership/topup-skus",{signal:e?.signal})`` | 1137807 |
| C085 | getCreditCoefficients | GET — ``_e.get("/membership/credit-coefficients",{signal:e?.signal})`` | 1137896 |
| C086 | createOrder | POST — ``_e.post("/orders",{sku_id:e,product_type:t,client_type:n,pay_channel:r,...i?{cycle_refresh_confirmed:!0}:{}})`` | 1138023 |
| C087 | getOrder | GET — ``_e.get(`/orders/${e}`,{signal:t?.signal})`` | 1138160 |
| C088 | getMyOrders | GET — ``_e.get("/orders",{params:e,signal:t?.signal})`` | 1138232 |
| C089 | trackEvent | POST — ``_e.post("/orders/track",{event_type:e,metadata:t\|\|{}})`` | 1138297 |
| C090 | t | GET — ``_e.get("/invite-codes/referral/mine",{signal:e?.signal})`` | 1142872 |
| C091 | e | POST — ``_e.post("/invite-codes/referral")`` | 1142976 |
| C092 | CIe | GET — ``_e.get(`/textbooks/${e}/chapters/extraction-status`,{timeout:sb,signal:t?.signal})`` | 1143984 |
| C093 | EIe | GET — ``_e.get(`/textbooks/${e}/chapters/batch-extract/quote`,{params:{chapters:r.join(",")},timeout:sb,signal:n?.signal})`` | 1144249 |
| C094 | AIe | POST — ``_e.post(`/textbooks/${e}/chapters/batch-extract`,{chapters:t},{suppressQuotaWall:!0,timeout:sb})`` | 1144415 |
| C095 | TIe | GET — ``_e.get(`/textbooks/${e}/chapters/batch-extract/${t}`,{timeout:sb,signal:n?.signal})`` | 1144565 |
| C096 | _Ie | POST — ``_e.post(`/textbooks/${e}/chapters/batch-extract/${t}/cancel`,void 0,{timeout:sb})`` | 1144700 |
| C097 | trackEvent | POST — ``_e.post("/activity/track",{event_type:e,metadata:t\|\|{}})`` | 1167532 |
| C098 | sendCode | POST — ``_e.post("/auth/send-otp",{phone:e,purpose:t,...n&&{captcha_lot_number:n.lot_number,captcha_output:n.captcha_output,captcha_pass_token:n.pass_token,captcha_gen_time:n.gen_time}})`` | 1193204 |
| C099 | login | POST — ``_e.post("/auth/login",{phone:e,code:t,agreed_terms:n??!1,device_info:r\|\|Kz()})`` | 1193410 |
| C100 | loginWithPassword | POST — ``_e.post("/auth/login-password",{phone:e,password:t,device_info:n\|\|Kz()})`` | 1193527 |
| C101 | checkNickname | GET — ``_e.get("/auth/check-nickname",{params:{nickname:e}})`` | 1193629 |
| C102 | register | POST — ``_e.post("/auth/register",{phone:e,code:t,nickname:n,password:r,invite_code:i})`` | 1193715 |
| C103 | refresh | POST — ``_e.post("/auth/refresh")`` | 1193817 |
| C104 | logout | POST — ``_e.post("/auth/logout")`` | 1193864 |
| C105 | getUserInfo | GET — ``_e.get("/users/me")`` | 1193915 |
| C106 | updateUserInfo | PUT — ``_e.put("/users/me",e)`` | 1193965 |
| C107 | resetPassword | POST — ``_e.post("/auth/reset-password",{phone:e,code:t,new_password:n})`` | 1194021 |
| C108 | changePassword | POST — ``_e.post("/users/me/change-password",e)`` | 1194115 |
| C109 | dJe | POST — ``_e.post("/highlights",e)`` | 2409509 |
| C110 | hJe | GET — ``_e.get("/highlights",{params:{textbook_id:e,kp_code:t}})`` | 2409577 |
| C111 | fJe | GET — ``_e.get("/highlights",{params:{textbook_id:e}})`` | 2409679 |
| C112 | pJe | DELETE — ``_e.delete(`/highlights/${e}`)`` | 2409764 |
| C113 | gJe | POST — ``_e.post("/highlights/notebook-open",e)`` | 2409826 |
| C114 | mJe | POST — ``_e.post("/highlights/jump-back",e)`` | 2409905 |
| C115 | xJe | PATCH — ``_e.patch(`/highlights/${e}`,{note:t})`` | 2409985 |
| C116 | bJe | PATCH — ``_e.patch(`/highlights/${e}`,{color:t})`` | 2410066 |
| C117 | Fet | GET — ``_e.get(e,{signal:t,validateStatus:()=>!0})`` | 2448624 |
| C118 | Get | POST — ``_e.post("/tts/speak/metrics",e)`` | 2451005 |
| C119 | $nt | POST — ``_e.post(`/textbooks/${e}/exports`,{kp_codes:t},{timeout:Fb})`` | 2512035 |
| C120 | Vnt | GET — ``_e.get(`/textbooks/${e}/exports/active`,{timeout:Fb,signal:t?.signal})`` | 2512147 |
| C121 | Hnt | GET — ``_e.get(`/exports/${e}`,{timeout:Fb,signal:t?.signal})`` | 2512270 |
| C122 | Wnt | GET — ``_e.get(`/exports/${e}/download`,{timeout:Fb})`` | 2512373 |
| C123 | Unt | POST — ``_e.post(`/exports/${e}/cancel`,void 0,{timeout:Fb})`` | 2512468 |
