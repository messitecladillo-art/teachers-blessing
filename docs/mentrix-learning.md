# 私人教材学习服务

这是依据公开可见产品行为独立实现的学习系统，不连接 Mentrix 的业务接口、账号或模型。竞赛包装暂缓；教材、课题材料、学习对话和笔记是当前主路径。根目录服务注入同一个私有 store 和模型适配器，未配置模型时生成入口返回503，不用模板伪装生成成功。

## 运行与私有资料

安装锁定依赖后运行 `npm start`。默认私有目录由主服务配置，开发环境为 `.local/learning/`；`study.json` 保存单进程串行事务，`learning-files/` 保存随机 UUID 文件名的原件。这些内容不在静态公开目录，也不应提交到 Git。所有文件、任务、知识点、作答、批注和下载均再次验证用户与父容器归属。基础注册、会话和教材/课题 CRUD 见认证服务实现。

本机实际限制：教材 PDF 不超过 **300 MiB、3000页**，Markdown 不超过5 MiB；课题 PDF/PNG/JPEG/WebP 不超过30 MiB，Markdown不超过5 MiB，每课题最多10文件。每用户原件存储预算1 GiB；删除后原件 tombstone 继续计入预算，直至受控维护清理，不能通过删除元数据绕过空间限制。本轮已实际验证自编3000页PDF与超过31MiB的有效PDF提取；没有测试完整300MiB实体，也不保证所有稠密文档均能在预算内处理，详见[容量说明](mentrix-pdf-capacity.md)。

图像在任何解码或OCR前先读取PNG IHDR、JPEG SOF或WebP容器中的实际尺寸；边长不能超过4096，总像素不能超过1200万。不能可靠读出尺寸、尺寸矛盾或解码失败的文件会被拒绝，因此30 MiB并不代表支持任意尺寸的压缩图片。

所有文档提取均进入固定 `learning/document-worker.mjs` 子进程：V8堆256 MiB、180秒总期限、16 MiB结果上限；原生内存另受文件/页/像素预算约束。父进程取消会终止处理进程，不传入模型凭据，不使用shell或动态用户脚本，stdout/stderr不转发来源文本。实际测试发现所用原生图像库可能在损坏PNG上直接退出进程，因此PDF渲染、图片解码和OCR都放在该边界内；异常退出不会升级ready。这是用于控制崩溃和任务预算的进程隔离，不是操作系统沙箱。

PDF使用本机 `pdfjs-dist` 提取实际文字、书签与页码；无书签时识别可见目录/章标题，仍无可靠结构时明确显示“按页分组，待修订”。Markdown使用实际标题行。每个章节、知识点都有持久ID和来源页/文件 SHA-256。重复解析相同结构保留ID；人工修订保留所给的合法ID，改变来源会增加修订号，并使旧讲解、练习和批注显示过期。目录正在修改时迟到的解析任务不会覆盖人工修订。

扫描件须显式请求本机OCR，语言数据预先放入 `ocr-langs/eng.traineddata` 或 `ocr-langs/chi_sim.traineddata`（也支持 gzip）。不自动从网络下载语言包。单任务最多5页、单页1200万像素；`startPage/endPage`选择范围，已有识别页可复用。剩余无文字页保持 `partial/pendingPages`，可继续提交其他范围；空白页、坏文件、加密PDF、缺失语言包均不伪装为全文就绪。OCR结果需要人工核对。

## HTTP合同

路径统一加 `/api/v1`；成功为 `{success:true,data:...}`，列表为 `data.items`；错误由共享API层返回状态码与错误码。以下入口均需登录。

| 操作 | 请求和返回 |
|---|---|
| 上传教材/课题文件 | `POST /textbooks/:id/files` 或 `/workshops/:id/files`；raw字节体，`X-File-Name: encodeURIComponent(filename)`；返回私有文件元数据，绝不返回磁盘路径 |
| 解析教材 | `POST /textbooks/:id/parse`，可带 `{ocr:true,ocrPages:3,ocrLanguage:"eng",startPage:1,endPage:3}`；课题用 `POST /workshops/:id/files/:fileId/parse`；返回202任务 |
| 查看来源 | `GET /files/:id/content?page=1` 返回一页实际文本和解析方法；`GET /files/:id/download` 私有下载原件。`GET /files/:id/preview`以inline预览PDF/PNG/JPEG/WebP，Markdown按text/plain显示；均为私有授权、nosniff/no-store |
| 管理文件 | `PATCH /files/:id {name}`仅修改同扩展名的显示名称，拒绝路径和实际存储字段。`DELETE /files/:id`清除pages/outline并保留deleted tombstone及bytes；活动parse/structure取消，教材相关知识点失效，迟到结果不能恢复来源。原件不物理擦盘，空间继续计费至私有维护；课题10个活动文件限制不把tombstone当活动文件 |
| 目录 | `GET /textbooks/:id/outline` 返回 `{status,outlineRevision,activeFileId,chapters,knowledgePoints}`；`PATCH` 提交 `{chapters:[{id?,title,startPage,endPage,knowledgePoints:[{id?,title,startPage?,endPage?}]}]}` |
| AI细分课程 | `POST /textbooks/:id/structure` 可选 `{startPage,endPage}`；每次最多20页/24000字符。任务完成得到 `artifacts` 的目录提案，`GET /artifacts/:id` 查看 `chapters/partial/inputTruncated/requiresConfirmation`；**不会自动应用**，用户核对后显式 PATCH 目录 |
| 知识点及进度 | `GET /knowledge-points/:id` 含来源文字；`PATCH /knowledge-points/:id/progress` 用 `{status:"not-started"|"learning"|"mastered"}`，兼容 `{completed:true}` |
| 讲解 | `POST /knowledge-points/:id/lesson {style?}` 返回任务；style严格为default/language_adaptive/english；`GET`版本字段含 `id/title/content/version/style/sourceRevision/sourceIds/status/stale`。风格保存于每个版本，历史记录缺失时显示未记录，不用当前偏好代替 |
| 练习 | `POST /knowledge-points/:id/exercises {type:"choice"|"short",count:1..5}`；`GET` 返回题目列表，服务端隐藏 `answer/explanation/rubric` |
| 作答与解析 | `POST /exercises/:id/attempts {clientAttemptId,answers:{questionId:value}}`；相同提交ID和答案返回同一次作答，换答案返回409。`GET /exercises/:id/attempts`返回本人列表；`GET /attempts/:id`返回本人答案、状态、revealedAt和已有评分，不含参考答案。`POST /attempts/:id/reveal` 才提供参考答案、解析和选择题正确性 |
| AI简答反馈 | `POST /attempts/:id/grade`返回202持久任务；完成后原子更新原attempt，`gradingJobId`关联任务。`grading={score,maxScore,feedback,questions:[{questionId,score,maxScore,feedback,sourceIds}],requiresHumanReview,method,sourceRevision}`。选择题每题1分，程序核对且不需要模型；简答每题固定5分，以半分刻度给AI建议分，requiresHumanReview=true，不代替人工评定。没有模型时简答返回503，不伪造评分 |
| 同上下文追问 | `GET/POST /textbooks/:id/conversations` 可带 `knowledgePointId`；`GET/POST /conversations/:id/messages`，生成请求 `{content,knowledgePointId?}`；`POST /conversations/:id/messages/:messageId/regenerate` 保留旧版本，成功后标记旧回答被替代。课题问答按实际用户问题检索全文中受预算约束的相关片段，返回sourceVersions中的实际sourcePages和retrieval范围信息 |
| 学习笔记 | `POST /textbooks/:id/artifacts {knowledgePointIds?,title?}` 汇编当前来源版本的AI讲解、本人笔记和追问，并追加该KP最新练习及本人最近作答/已有评分；参考答案和解析仅在对应attempt.revealedAt存在时汇编，旧快照不会追补新答案。AI/个人内容分别标注，作答/建议分不当作客观能力或已掌握声明；每KP最多最近20次有效回答、单份2MiB。`GET`同路径查看版本；`GET /artifacts/:id/download`默认Markdown，`?format=html`为安全离线阅读包，仍校验owner和教材父链 |
| 精确划线 | `POST /highlights {sourceId:kpId,revision,sourceKind:"source"|"lesson",lessonId?,exact,prefix?,suffix?,occurrence?,note?,color?}`；讲解划线绑定该讲解版本。`GET /highlights?sourceId=...`返回定位或stale；`PATCH/DELETE /highlights/:id`修改笔记/颜色或删除。未提供 occurrence 时，多处同文须补上下文，不随意定位第一处 |

对话批注使用 `{sourceKind:"conversation",sourceId:messageId,revision:1,exact,...}`，服务端派生conversationId、textbookId/workshopId和knowledgePointId；不会采信请求自填归属。消息ID固定，即使被重新生成的回答替代，旧笔记仍固定在原消息；来源改版或父会话不存在时显示stale，不跳到另一份同文。

练习批注使用 `{sourceKind:"exercise",sourceId:exerciseId,questionId,block,attemptId?,revision:exercise.sourceRevision,exact,...}`。block为stem、reference_answer、solution或feedback；stem在本人题集可见，reference_answer/solution必须先通过本人同练习作答且revealedAt存在的权限门，再读取参考文本、计算hash或尝试exact匹配。未揭示时猜A/B得到相同拒绝，不能把批注当猜答案接口。feedback只允许本人已graded且该题存在的反馈，自动保存 `attemptGradingVersion/gradingJobId/gradedAt`；即使新评分文案相同，旧笔记也标stale。题目解析的可定位文本为explanation后接rubric换行，参考答案为answer字段。

所有新批注派生 `knowledgePointId/knowledgePointRevision`，因此 `GET /highlights?sourceId=kpId`也收录其子对话和题目笔记。PATCH/DELETE继续核验本人和父链；旧来源可管理自己的笔记，但不能伪称当前位置仍有效。

离线HTML由 `learning/export.mjs` 从已持久化Markdown生成，不触发模型：固定本地脚本、样式及字体内嵌，CSP限制网络、图片禁用，可离线阅读和打印；它不是DOCX/PPTX。只有markdown学习产物可导出，不把目录JSON提案伪装成HTML笔记。

任务查询为 `GET /jobs/:id` 或 `GET /jobs`；状态包括queued、running、cancelling、cancelled、completed、failed和interrupted。完成后的 `result` 通常为 `{id,collection}`，解析为 `{fileId,textbookId,pageCount,partial,pendingPages}`。`POST /jobs/:id/cancel`请求取消，`POST /jobs/:id/resume`显式创建关联原任务的新任务。重启后中断任务不会自动重发可能计费的模型请求。

浏览器实际复核发现，渲染段落的单换行可能不同于原始Markdown双换行，导致第二处同文的上下文无法精确匹配。锚点现保留全部exact位置：唯一上下文直接命中；多个上下文以全局occurrence核对；上下文全失配但明确occurrence合法时返回 `strategy:"occurrence-fallback",requiresReview:true`。这只说明按出现次序保留了候选，不能宣称上下文已核验，界面须提醒人工核对；没有明确hint的多候选仍保持歧义。

课题材料检索使用 `learning/retrieval.mjs` 的确定性关键词方法，先过滤本人、当前课题和ready文件，再扫描实际页文本；不是只取文件开头2000字。每次最多扫描400万字符/256材料，返回最多10来源、单源6000字符、合计20000字符，并记录真实页码、coverage、scanTruncated、outputTruncated和无命中fallback。它不是向量检索，也不保证已经阅读完整文件；模型提示明确限于提供片段。重新生成会找到目标回答之前的本人问题，即使目标已被后续回答替代，也不会误用最新问题或助手回答里的词作为检索条件。

## 生成、预算与验证边界

模型接收 `{messages,temperature,signal}`，返回文本。来源使用独立、有界用户数据消息，固定系统规则要求不执行来源中的指令；这是一项防护设计，不保证免疫所有提示注入。讲解、练习、对话及课程提案必须返回受校验JSON，引用必须属于本次输入。选择题校验选项唯一性、答案枚举、题量和题型；简答校验参考答案和评分要点。非法JSON、空输出、坏引用、取消、超时和来源过期均不保存成功内容。

讲解提示按“直觉→分步推导→来源可核对示例→常见误区→自检”组织，不能凭空补出教材例题。AI简答评分另校验题目ID、固定满分、分数范围/刻度与来源引用，并绑定本人答案hash、题组、来源修订和本次任务ID。失败释放任务单位，取消、坏输出、来源变化与迟到响应不会把作答改为graded，可显式重试；旧反馈不会被失败的新响应替换。评分成功也不会自动揭示参考答案。

每用户最多2个任务，全机最多4个任务，每用户每日默认100个本机任务单位；生成预留1单位，OCR按页预算预留。成功结算，失败/取消释放本机单位。账本明确不等于上游实际费用；取消后供应商是否已计费可能未知，系统不自动重试。异步提交重新检查任务、父容器、来源修订与会话状态；版本号在提交事务内分配。所有生成内容标记待核对，不宣称已掌握知识或提高学习效果。

解析选项在任何账本或任务写入之前校验：ocr必须是布尔值，ocrPages为1至5整数，页范围必须合法；所有单位必须为非负有限整数。负页数、浮点、错误类型不能通过预留负单位绕过已满预算。图片OCR固定按1页预算。

同一用户、同一文件已有queued/running/cancelling解析时，第二个解析请求在写入任务/账本前返回409 FILE_BUSY，避免并发OCR页范围用旧快照覆盖；不同文件仍可按并发预算并行。

执行 `node --test tests/study-learning.test.mjs` 可复核实际PDF文字/可见目录、来源边界和稳定ID、模型结构拒绝、权限、取消晚到、练习答案隐藏、作答幂等、讲解锚点、并发版本、预算和Markdown下载。测试只用自制合成文件与mock模型；可选扫描测试仅在本机合成fixture和本机语言包存在时执行，否则明确skip。浏览器交互、真实模型质量和实际供应商计费需另行验证；该单进程本地原型不代表已部署多用户生产平台。
