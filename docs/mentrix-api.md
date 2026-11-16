# 本地学习账号、资料与持久化API

这是独立实现的本地学习系统，不调用Mentrix线上接口，不包含Mentrix会话、账号或私有数据。核心目标是承载教材→章节/知识点→讲解/追问/练习/笔记/进度；本文件说明M01负责的账号、资料组织和运行边界。模型与教材服务的细节见`mentrix-learning.md`。

## 接入合同

`createStudyHandler({dataDir,model})`返回`async(req,res,pathname)=>handledBoolean`。不属于`/api/v1/`时返回false。创建handler、导入模块和访问公开配置均不会创建运行目录；第一次成功mutation才写入私有存储。

服务器必须在分派前执行与`/api/ai`同等级的Host/Origin检查，浏览器变更请求只允许同源，不能把本handler直接挂成开放跨域接口。部署者可启用`EDU_STUDY_SECURE_COOKIES=1`用于HTTPS；本机HTTP默认不加Secure。默认运行目录`.local/study`必须被Git及静态文件服务排除。

成功：`{success:true,data}`。失败：`{success:false,error:{code,message}}`。列表为`data:{items:[]}`；最多返回最近200条。单实体直接放data。错误不会公开内部异常堆栈、密码hash或session。

注入的`model({messages,temperature,signal})=>Promise<string>`由根服务负责固定上游、Key、大小、超时及可信配置状态；只在真实配置可用时注入函数。测试以mock代替，不代表任何真实模型或支付调用成功。

## 本地账号与会话

| Method | 路径（统一前缀/api/v1） | 输入/行为 |
|---|---|---|
| GET | `/config/public` | local_password注册模式、模型/SMS/支付是否配置；不公开Key |
| POST | `/auth/register` | `{email,password,nickname}`；密码8–128字符，邮箱仅作本地账号标识，未声称已验证邮箱；返回user/preferences与session cookie |
| POST | `/auth/login-password` 或 `/auth/login` | `{email,password}`；不是短信code登录 |
| GET | `/users/me` 或 `/auth/me` | `{user:{id,email,nickname,createdAt},preferences}` |
| PATCH | `/users/me` | `{nickname}` |
| POST | `/auth/refresh` | 旧session失效并换新cookie；不返回access token |
| POST | `/auth/logout` | 服务器撤销当前session并清cookie |
| POST | `/users/me/change-password` | `{currentPassword,newPassword}`；成功后撤销全部会话，需要重登 |
| POST | `/auth/send-otp`、`/auth/reset-password` | 503外部验证服务未配置，不假装发短信/邮件或重置成功 |
| GET/PATCH | `/users/me/preferences` 或 `/preferences` | theme=light/dark/system、language=zh-CN/en、teachingStyle=default/language_adaptive/english、fontScale=0.8–1.5 |

密码采用每账号随机salt+scrypt派生，磁盘不存明文。session为32随机字节，磁盘仅存SHA-256；cookie为HttpOnly、SameSite=Strict、Path=/api/v1，默认7天到期并在服务端检查。每账号最多保留10个有效会话。认证入口有本进程的失败/尝试频率与并发约束，不等于生产级分布式风控。

## 核心资料路由

所有私有实体包含`id/userId/createdAt/updatedAt/revision`，userId由会话决定，不接受前端传属主；不存在或越权统一404。PATCH可带`expectedRevision`，旧版本409。

| 路径 | 方法与字段 |
|---|---|
| `/folders`（兼容`/textbook-folders`） | GET列表；POST `{name}`；`/:id` PATCH `{name,expectedRevision?}`、DELETE。删除文件夹仅把教材移回未分类 |
| `/textbooks` | GET可按folderId筛选；POST `{title,folderId?}`创建empty教材壳；`/:id` GET/PATCH `{title?,folderId?,expectedRevision?}`/DELETE |
| `/workshops` | GET/POST `{title,linkedTextbookIds?}`；`/:id` GET/PATCH `{title?,linkedTextbookIds?,expectedRevision?}`/DELETE；所有关联教材必须属当前用户 |
| `/workshops/:id/materials` | GET；POST `{name,text}`，文本≤80,000字符；`/:materialId` DELETE。文件上传由教材学习服务负责，存入fileRecords而非此文本集合 |
| `/workshops/:id/conversations` | GET；POST `{title?,persona?,knowledgePointId?}`。知识点必须属用户且所在教材已关联工作坊 |
| `/conversations/:id` | GET含messages；PATCH `{title?,persona?,expectedRevision?}`；DELETE级联消息/任务等。消息生成另见学习服务 |
| `/feedbacks`、`/feedbacks/mine` | GET当前用户反馈；POST `/feedbacks` `{title,content}`；GET `/:id`；POST `/:id/replies` `{content}`。状态submitted_local，仅表示本地保存，不伪造人工客服回复 |
| `/statistics` | 从实际本地记录统计教材/知识点/讲解/练习/作答/批注/工作坊/消息数量及近期activity |
| `/users/me/quota` | mode=local_unmetered、billingConfigured=false、balance=null、资源上限；不显示虚构充值余额 |
| `/credits/ledger` | 当前用户已有账本记录，billingConfigured=false、balance=null；无记录就返回空列表 |
| `/announcements` | 公开的本地运行说明，不伪装Mentrix官方公告 |
| `/membership/skus`、`/membership/topup-skus`、`/membership/credit-coefficients`、GET `/orders` | configured=false、items为空，真实会员/支付未配置 |
| POST `/orders` | 503，未创建或扣款任何真实订单 |

上传、解析、目录、知识点讲解、练习、追问、产物、批注等未由上表处理的路径，在认证后交`createLearningService({store,model,dataDir,...helpers}).handle(req,res,pathname,user)`。共享helpers为readJson/send/fail/error/id/now/owned/recordActivity；传入user不含密码与session。

## 存储与删除

`createStudyStore({dataDir})`提供`await snapshot()`深拷贝、`await mutate(fn)`串行事务。mutation在独立草稿执行，成功经JSON校验、大小检查、私有临时文件写入+fsync+原子rename后才发布内存状态；失败不覆盖此前状态。临时文件使用wx与0600权限。JSON上限64MiB、每集合最多20,000条，教材/文件夹各用户最多100个。

schema=1，集合为users/sessions/folders/textbooks/workshops/materials/fileRecords/conversations/messages/jobs/chapters/knowledgePoints/lessons/exercises/attempts/artifacts/highlights/feedbacks/ledger/activity。不存在的库第一次读取返回空快照，不自动落盘；已有JSON损坏/版本不支持时失败关闭，不静默重置数据。重启可重新读出账号、会话、版本与学习记录。

该机制只适用于单Node进程、单store实例；不是多进程数据库，也不提供跨主机锁、行级并发或生产备份。事务内不得再次调用store或执行模型外呼，以免排队自锁/长时间阻塞。并发任务应先短事务预留，外呼后再以owner、输入版本、runId和当前父实体存在性核对写回。

删除教材/工作坊/会话按关系ID闭包级联，包含仅通过exerciseId、conversationId或job.payload关联的子记录。异步学习服务仍须在写回时复核父对象与run状态，不能因已开始外呼就复活已删除内容。

上传二进制不属于JSON事务：删除后保留精简fileRecords tombstone（status=deleted、bytes、storedName、hash等），去掉提取文本/pages/outline。私有原文件暂留磁盘，继续计入该用户上传容量，读取拒绝deleted/无父实体记录，因此不能通过上传→删除绕过空间配额。它不是“已物理擦除”的承诺。只有显式私有清理删除文件并核对成功后才可释放占用；本期没有自动垃圾回收与备份清理界面。

本地JSON保存用户资料和教材文本，具有隐私性；不要放入Git、静态白名单或公开网盘。公网部署需另加HTTPS、真实身份验证/找回机制、可审计配额与限流、备份/恢复和存储治理；当前不能称作与Mentrix生产后台等价。

## 本轮验证

`node --test tests/study-api.test.mjs`使用独立临时目录、纯合成账号与mock/stub服务。覆盖lazy落盘、密码与session hash、会话轮换/到期/退出/改密撤销、两用户IDOR、父实体授权、revision、偏好与重启、串行mutate/回滚、间接级联与文件tombstone、真实未配置状态。Host/Origin必须由根server的集成测试独立验证，本测试不把裸handler当成已加网络边界的公网服务。
