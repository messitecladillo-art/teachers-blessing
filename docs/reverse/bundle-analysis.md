> 公开整理版：移除本机绝对路径。下文的 evidence/ 与 REA Evidence ID 指向本地原始审计资料，未随公开仓库上传；不包含账号会话、第三方原始脚本或可运行的 Mentrix 克隆。

# M03：Mentrix 主 bundle 获取与业务静态分析

任务 M03；制作人 `/root/architecture`；接收人 `/root`。输入修订为 `.collab/evidence/source-manifest-v2.sha256`，摘要 `41954fe36c041da5c8802736ae910f680536a1792215884368bd0f03f2d3650e`。本次新增公开源与派生证据见下表，由协调者另行封存新修订。未修改“正大杯2”原工程，未读取浏览器 cookie、localStorage 实际值或任何账号凭据。

## 本次结论

公开主 bundle 已完整保存，确认 Mentrix 是围绕 PDF 教材、章节知识点、AI 讲解、练习、划线笔记和工作坊对话组织的学习型 SPA。路由表可从实际交付代码恢复，接口调用契约和前端状态处理可静态核查。它不能证明后端代码、模型、数据表、生产权限和每条功能都已在线可用。

主文件为 `corpus-source/mentrix/public-bundle/index-rKI-61y3.js`，2,979,827 bytes，SHA-256 `a46069288fd0841733d470ca5510fdb463e1dcd70458e44b1e2edcb62eecf541`。2026-11-16 12:42:15–12:42:16（Asia/Shanghai）使用 Node v24.22.1 原生 fetch，一次公开静态 GET 获得 HTTP 200。请求 `credentials:omit`、redirect:error、TLS 默认校验开启；无 cookie、无代理配置修改、无远程调试 Chrome。响应 content-type 为 application/javascript，last-modified 为 Wed, 11 Nov 2026 01:20:15 GMT。获取日志为 `evidence/rea/static-bundle/node-fetch-attempt.json`。

## REA 真实运行与能力边界

| 分析 | 证据 | 结果 | 解释 |
|---|---|---|---|
| 完整 2.98 MB 主 bundle 的首次离线分析 | parent `ev_60b37397aea75971ae80cf92815d242878433eb52abda24b6da2a31c19807070`；`javascript-evidence.json` / `javascript-summary.json` | CLI exit 0，但 1536 MiB old-space heap 耗尽；parsed JS=0、skipped=1；application/semantic coverage 均 partial | exit 0 不是静态分析完整成功。保留原始 partial 证据，不再提高内存或重复相同调用 |
| 完整语法边界的业务声明片段 | parent `ev_fa8e08a361e9f5ca3ad0b14033c98562f30513706751b2466ae3b9ca0820f6be`；`business-fragments-evidence.json` / `business-fragments-summary.json` | 65,656 bytes、96 条原始顶层声明，parsed JS=1、skipped=0、visited AST nodes=14,539、findings=109；5 秒左右完成 | 所选文件 syntax complete / examination complete；application 仍 partial，semantic unknown，5,636 个语义 unknown。未选依赖保留未知，不能外推全站语义完整 |

业务片段通过已安装的 `@babel/parser` 对原始主文件进行惰性 AST 解析后选择，目标代码从未执行；只选择包含 `_e` API 客户端调用、指定认证函数、路由表、主题声明的完整顶层声明，单声明上限 55,000 字符。原声明原样串联，仅新增分隔注释。新文件 SHA-256 为 `4d54936dfaed75dde082fc77dfe305ceda99d57b47690d258688eb183c2bdea3`。

映射保存于 `business-fragment-source-map.json`，每条记录有原始 UTF-8 byte 起止、行号、派生字符起止、独立内容 hash。提取器为 `extract-business-fragments.mjs`，派生源为 `business-fragments/business-fragments.js`。注意 Babel/JavaScript 字符下标为 UTF-16 code units；后述 Python 文本提取器的 char_offset 为 Unicode code points，二者不能直接混用。跨证据定位请统一使用 `utf8_byte_offset` 或原始行号+符号名。

REA 的 route inventory 仍把路由识别标为静态候选，且存在动态路由配置和未绑定路由构造器等 unknown；不能把 summary 的 complete-within-view 当作整个应用 complete。

## observed in shipped code：前端技术与状态契约

下列“observed”指读到原始交付代码，不指在登录态运行成功。主要行号来自原始主 JS；完整 byte 定位在 `claim-source-locations.json`。

| ID | 事实 | 代码定位 | 不能推导 |
|---|---|---|---|
| B01 | react-dom renderer 自声明 19.2.3 | 第 9 行 `version:"19.2.3",rendererPackageName:"react-dom"` | 不能推导所有 React 生态包都为这个版本 |
| B02 | SPA 路由为 React Router 体系；最终以 `x6e([{errorElement:...,children:vft}])` 绑定路由表 | 第 550 行 `const vft=` / `bC=x6e` | 不证明每条路径已在线验收 |
| B03 | Chakra 工厂和 Emotion 样式实现、Lucide 图标、Zustand store/persist 代码已交付 | `chakra-ui > factory`、`__emotion_*`、zustand devtools 文本；第 31 行 store | 不武断声明 Chakra/Zustand 等精确版本 |
| B04 | 交付配置含 `MODE:"production"`、`SSR:!1`、`VITE_API_BASE_URL:"/api/v1"`、`VITE_ADMIN_ENABLED:"false"` | 第 20 行 `cN=` | 支持 Vite 风格生产构建识别；不证明后端框架或不存在独立管理端 |
| B05 | API client 默认 `/api/v1`、JSON、timeout 120s、`withCredentials:true`；一般请求附 Bearer accessToken | 第 30 行 `U5e` / `H5e` / `vX` | 仅前端实现，不证明服务端 Cookie 配置和权限正确性 |
| B06 | `/auth/send-otp`、`/auth/login`、`/auth/refresh`、`/config/public` 是不附 Bearer 的名单 | 第 30 行 `V5e` / `yX` | 不等于无需验证码、Cookie 或服务端校验 |
| B07 | 401 触发单次 refresh 后重放；refresh 请求并发合并；503 最多三次等待重试 | 第 30 行 `B5e` / `W5e` | 不能证明所有自定义 fetch 都统一应用该策略 |
| B08 | accessToken/user/expiresAt/isAuthenticated 通过 Zustand persist 存到 localStorage 的 `auth-storage`；有提前30秒过期判断 | 第 31 行 `Ol={getItem...}`、`Ht=Pr()`、`partialize` | 未读取用户实际 token；HttpOnly refresh Cookie 的属性仍未知 |
| B09 | 用户退出会清空多类查询与生成状态；学习与练习草稿也有本地持久化 | 第 31 行 `YN` / `Eg` / `exercise-draft:` | 不证明所有数据都在本地或后端未保存 |
| B10 | SSE 使用 fetch/readable stream、`event:`/`data:`解析，有 AbortController；教学 reducer 处理 queued、text_delta、process_step、moderation_regenerating、done、error | 第 31 行 `IN` / `H1` / `CAe` | 前端支持流式协议；真实事件速率、服务端 agent 架构、模型供应商未知 |
| B11 | PDF 上传存在 OSS SDK 动态加载与临时凭证形式、multipart upload、完成确认；聊天内联图片有直传/回退流程 | 第 31 行 `HN` / `IX` / `qAe` / `GAe` | 可以说前端实现了 OSS 直传适配，不能说观察到了真实 bucket 或凭证，也不能概括所有文件都用同一存储 |
| B12 | 所选功能围绕教材→章节→知识点；另有工作坊→文件/对话结构 | 第 31 行 API 与 query-key 表；550 行路由表 | 只是前端概念对象，不是数据库 DDL |

## 真实交付路由表：24 个配置项

下面为第 550 行 `vft` 中的配置项，包含 catch-all；`oDe` / `aDe` 的常量定义位于第 54 行。完整逐项位置见 `evidence/rea/static-bundle/route-table.csv`。路由字段存在属于 shipped-code 事实；运行可达性统一为 static candidate，须与协调者登录后只读核验结果逐条合并。

| 分组 | 路径 |
|---|---|
| 认证 | `/login`、`/register`、`/forgot-password` |
| 协议 | `/terms`、`/privacy`、`/payment-terms` |
| 预览 | `/preview/preparation` |
| 工作台与个人页 | `/`、`/upload`、`/statistics`、`/settings`、`/membership`、`/payment/return`、`/feedback` |
| 教材库 | `/textbooks`、`/textbook/:textbookId`、`/textbook/:textbookId/extraction` |
| 学习 | `/textbook/:textbookId/chapters/:chapterNum`、`/textbook/:textbookId/chapters/:chapterNum/artifacts/:artifactType`、`/textbook/:textbookId/qa` |
| 工作坊 | `/workshops`、`/workshops/new`、`/workshops/:wid` |
| 未匹配 | `*` |

不能采用凭产品印象推测的 `/my_course` 等旧路径作为现行证据。本文件没有对路由做在线请求；由协调者负责合法登录态的只读核实。

## 接口候选：121 个调用点、117 个去重 method+expression

从完整主文件对 `_e.get/post/put/patch/delete(<literal or template>)` 做有范围声明的文本提取，获得 121 个匹配调用点、117 个去重 method+path expression。完整清单为 `endpoint-candidates.csv`；带前后文的记录为 `textual-candidates.json`。这是此种语法模式的匹配结果，**不是已验证 API 数量、不是全部 API 的分母**。动态函数、SSE URL、OSS 上传及自定义 fetch 不在这个计数内。

一般路径前缀为 `/api/v1`，变量保留模板形态，不替换成用户教材、会话或账号 ID。真实响应 schema 需要合法调用捕获；本文只恢复调用侧契约。

| 功能域 | 调用候选示例 | 调用侧事实 |
|---|---|---|
| 认证 | POST `/auth/send-otp`、`/auth/login`、`/auth/login-password`、`/auth/register`、`/auth/refresh`、`/auth/logout`、`/auth/reset-password` | 短信登录发送 phone/code/agreed_terms/device_info；密码登录发送 phone/password/device_info；注册另带 nickname/password/invite_code |
| 用户 | GET/PUT `/users/me`、POST `/users/me/change-password` | 前端有个人资料与修改密码适配 |
| 教材 | GET `/textbooks`、GET/PATCH/DELETE `/textbooks/${e}`、PUT `/textbooks/layout` | 列表、详情、布局与重命名/删除客户端操作 |
| 上传/OCR | POST `/textbooks/upload-credentials`、`/textbooks/${e}/complete`、GET `/textbooks/${e}/ocr`、POST `/textbooks/${e}/ocr/retry` | 前端有凭证、完成确认、OCR状态与重试适配；本任务未上传任何文件 |
| 目录/知识图谱 | POST `/textbooks/${e}/toc/auto-detect`、`/textbooks/${e}/agent/toc`、`/textbooks/${e}/agent/knowledge-graph`；GET `/textbooks/${e}/agent/knowledge-graph/status` | 目录检测、知识点提取、force 参数存在客户端契约 |
| 章节流水线 | POST/GET `/textbooks/${e}/chapters/${t}/flow`、GET `.../flow/quote`、POST `.../flow/cancel` | stages 含 ocr/extract/prep；有估价、状态、取消流程 |
| 讲解 | GET `/textbooks/${e}/agent/chapters/${t}/context`、`.../plan`、GET `/textbooks/${e}/agent/kp/${t}/lesson`、`.../conversation`、`.../lesson/metadata` | `lesson`按text接收，202/204视作暂未就绪 |
| 练习 | `/textbooks/${e}/agent/kp/${t}/exercises` 系列 | quote、生成、sets、取消、恢复、作答attempts、reveal、flag、key；mc/exp 为题量相关参数，准确语义需UI合并 |
| 章节产物 | `/textbooks/${e}/chapters/${t}/artifacts`、`.../artifacts/${n}/generate`、`/chapter-artifacts/${e}/content`、`.../download` | 读材料、写笔记、校验修复、离线打包四阶段文字已交付；产物内容按text，下载按blob接收 |
| 批注 | POST/GET `/highlights`、PATCH/DELETE `/highlights/${e}`、POST `/highlights/notebook-open`、`/highlights/jump-back` | 多色批注、笔记与跳回有客户端适配；持久化正确性未测 |
| TTS | GET `/tts/config`、POST `/tts/speak`、POST `/tts/speak/metrics` | 配置缓存5分钟；播放侧有首字节/全流耗时指标上报 |
| 工作坊 | `/workshops`、`/workshops/${e}`、`.../files`、`.../files/${t}/preview-url`、`.../files/${t}/ocr` | CRUD、文件预览/OCR；本任务只读源码，不调用写操作 |
| 会话 | GET/PATCH `/conversations/${e}`、POST `.../cancel`、GET/POST `/workshops/${e}/conversations` | title/persona/is_deleted 通过 PATCH；会话创建带 container_type=workshop、api_format=response_api |
| 导出 | POST `/textbooks/${e}/exports`、GET `.../exports/active`、GET `/exports/${e}`、`.../download`、POST `.../cancel` | 异步导出状态与下载契约，未下载用户教材 |
| 配额/会员/订单 | GET `/users/me/quota`、`/membership/skus`、`/membership/topup-skus`、`/membership/credit-coefficients`；POST/GET `/orders` | 不把源码内默认套餐/价格当现时生产价格；不触发订单或付费 |
| 支持与统计 | `/announcements`、`/feedbacks`、`/feedbacks/mine`、`/feedbacks/${e}/replies`、POST `/activity/track` | 支持公告、反馈与埋点接口适配 |

计数外的明确静态 URL 构造器还包括：

- `/api/v1/textbooks/${e}/chapters/${t}/flow/stream`；
- `/api/v1/chapter-artifacts/${e}/generation/stream`；
- `/api/v1/textbooks/${e}/agent/kp/${t}/exercises/${n}/stream`；
- `/api/v1/textbooks/${e}/agent/chapters/${t}/teach`，POST body含 kp_id/action 与可选 user_message；
- `/api/v1/conversations/${e}/messages`、`.../regenerate`、`.../inline-images` 与 inline-images upload-credentials/complete/thumbnail；
- `/api/v1/textbooks/upload-events?client_upload_id=...&token=...`；这是源码模板，不是实际 token；
- `/api/v1/errors/frontend` 与教材章节图片URL构造器。

本任务未向这些业务接口发请求。

## 可据此写出的前端规格

1. **认证壳**：默认密码模式；手机号只留数字、最多11位，验证码最多6位；登录前需同意协议；按钮按号码、密码/验证码、协议、loading状态启用。登录后按 returnUrl 导航。源码存在密码与短信两种登录，但真实认证和风控规则须以线上合法运行补证。
2. **教材导入与提取**：PDF上传→临时直传凭证/SDK→完成确认→OCR/目录→章节知识点。流程显示排队、处理中、进度、失败、取消；估价接口与配额错误分支在客户端体现。后端OCR及知识图谱算法未知。
3. **学习闭环**：教材/章节→知识点计划→流式讲解→追问对话→练习→尝试记录/解析→学习进度；讲义有中文/英文、不同风格参数线索；不要据参数推断模型。
4. **笔记与产物**：阅读中多色划线/批注/跳回，章节笔记可显示 read_materials→write_note→validate_repair→package_offline 的四阶段过程，并有产物内容与下载入口。是否已实际生成有效离线包，仍需用户授权功能验收。
5. **工作坊**：会话+用户材料+关联教材范围；对话UI支持工具过程卡片。交付代码列出 `search_kp_hybrid`、`read_kp_detail`、`read_textbook`、`web_research`、`read_web_pdf` 等工具名。只能说前端识别/请求这些工具，不能据此恢复服务端实现。
6. **资源与计费呈现**：前端处理积分不足2001、每日上限2002、功能未解锁2004、已有任务USER_TASK_ACTIVE等错误；有会员、topup、订单及配额弹窗。没有实际付费和额度消耗验证。

## 视觉规格已从代码补全

第一轮仅能观察 DOM/CSS，此次主JS明确补出登录卡片：全页背景 `linear-gradient(180deg,#E8F5EC 0%,#FAF9F6 100%)`；卡片背景 `#FAF8F3`、max-width 420px、响应宽度 base90%/sm380px/md420px、radius16px、shadow `0 10px 40px rgba(0,0,0,0.12)`、边框 `1px solid rgba(224,217,203,0.5)`；输入高度48px、radius8px、2px边框；卡片 slideUp 0.4s，from translateY20px。

全局主题第550行 `const kft=` 明确声明 forest/wood/summary原始色和light/dark语义色：bg `#FAF9F6/#131C17`，panel `#FFFFFF/#1B2820`，muted `#ECE5D8/#253029`，fg `#1A1A1A/#EAEFEA`，次文字 `#5A5346/#B4C1B8`。heading font为Playfair Display+LXGW WenKai；body为Lora+LXGW WenKai。这些是源码设定，实际字体可用性和每屏计算后样式仍由截图核实。

## 文件清单与复核入口

- 公开原始主 JS：`corpus-source/mentrix/public-bundle/index-rKI-61y3.js`。
- 来源记录：`evidence/rea/static-bundle/node-fetch-attempt.json`。
- 原始全文 REA partial：`javascript-evidence.json`（34,501 bytes）与 `javascript-summary.json`。
- 片段映射：`business-fragment-source-map.json`；原样派生声明：`business-fragments/business-fragments.js`。
- 片段 REA：`business-fragments-evidence.json`（17,320,894 bytes）与 `business-fragments-summary.json`。优先读 summary 的真实 coverage，再按需查 full Evidence；summary 显示完整不消除语义未知。
- 路由表：`route-table.csv`，24项，含位置与static_candidate标签。
- 接口候选：`endpoint-candidates.csv`，121调用点；`textual-candidates.json`含前后文和源hash。
- 主张定位：`claim-source-locations.json`。
- 获取脚本与提取脚本均在同一 evidence 子目录，可重查执行逻辑；获取脚本使用 wx，不会覆盖旧证据，不能原样重复运行来改写日志。

## 给协调者的验收与下一步

本次 M03 的“获取公开主JS并进行一次有边界REA静态分析”已完成；原完整文件分析的资源限制保留，片段分析成功但语义unknown。请将24项真实路由与TinyFish登录后只读结果按 observed/static_candidate/unknown 合并，不将首轮猜测URL加入事实库。优先核实 `/textbooks`、真实教材详情、`/statistics`、`/settings`、`/membership`、现有工作坊与章节学习页面；创建工作坊、生成讲义/练习、导出、TTS、上传、支付属于另外的执行/计费范围，不因看到按钮而认定已验证。

status: PRODUCED；outcome: done（scope=M03_public_bundle_and_bounded_static_analysis，不代表全站行为完整或后端恢复）。
