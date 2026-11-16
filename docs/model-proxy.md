# 同源模型代理

网页通过 `TeachingAI.chat({messages, model?, temperature?, signal?})` 调用本站 `/api/ai/chat`，返回 OpenAI 风格的 JSON。Key只存在于 Node 服务端环境；浏览器没有Key输入框，不保存、接收或转发服务端Key。未配置真实模型时返回503及中文说明，页面仍可使用静态资料和本地课堂计算，不生成虚假的AI成功结果。

## 本地运行

需要 Node 22 或更高版本。无配置预览使用 `npm start` 或 `node server.mjs`，默认地址为 `http://127.0.0.1:3285`；`PORT`可改端口。不要直接双击HTML并预期模型可用。

复制 `.env.example` 为仅保存在本机的 `.env`，设置真实服务的 `EDU_AIGC_API_KEY`、`EDU_AIGC_MODEL`，确认 `.env`被Git忽略，然后运行：

```powershell
node --env-file=.env server.mjs
```

服务不会自动加载.env；环境配置变更后重启。不要把Key填进HTML、JavaScript、截图或提交记录。此仓库此前暴露过浏览器端凭据；删除源码不能撤销历史泄露，原持有人须在供应商端撤销并另建新Key，不能沿用旧值。

`EDU_AIGC_API_URL`为运营者指定的完整OpenAI兼容 `.../chat/completions` URL，默认指向OpenRouter；HTTPS必需，自建本机服务仅允许loopback HTTP。拒绝URL中用户名、密码、查询参数、fragment和重定向。浏览器不能指定上游URL、Key或任意HTTP头。

`EDU_AIGC_MODEL`是默认精确模型ID；`EDU_AIGC_ALLOWED_MODELS`可提供逗号分隔列表，默认仅允许默认模型。显式请求未允许模型返回400，不静默改成另一种模型。`GET /api/ai/config`只返回`configured/model/allowedModels`，页面可用来填充选择器。

## 边界与错误

- 默认每请求最多128KiB、1–40条消息、单消息最多24,000字符、总文本64,000字符；只接受system/user/assistant纯文本。
- temperature在0–2之间。输出token上限默认4096，运营者可设置1–16384；浏览器不能突破此上限。
- 模型总等待默认30秒、最大120秒；请求体读取限15秒；上游响应最多1MiB；默认同时最多2个模型请求。
- POST要求本站Origin和JSON内容类型；不提供跨域CORS。Host仅允许loopback或运营者显式列出的反向代理Origin对应主机。`null`、跨站或缺少Origin的模型POST被拒绝。
- 上游返回错误时只公开固定中文消息和错误码，不回显响应体、鉴权头、配置或异常堆栈。限流返回429，超时504，连接/上游错误502；不自动重试付费请求。
- 成功响应只保留必要的chat字段。模型内容仍是不可信文本；`renderMarkdown`仅在marked与DOMPurify都存在时解析并净化，否则HTML转义为文本。`sanitizeHtml`缺少净化器时也只转义，绝不退化为原样HTML。
- 静态资源严格白名单：当前根目录前端文件及assets/asset/data/vendor内允许扩展的资源。拒绝.env、.git、服务端源码、platform源码、隐藏路径、穿越与符号链接；不提供目录索引。

本服务是本机开发与演示入口，不是公网多用户计费平台：尚无用户登录、每人配额、持久化审计、账单对账或防滥用网关。公开托管前由部署者增加HTTPS反向代理、鉴权与配额，并明确配置允许Origin；不能仅把监听地址改成公网就视为生产部署。模型供应商仍会收到用户提交的对话，请仅提交有权使用的材料，避免发送未脱敏学生信息。

## 验证

```powershell
node --test tests/ai-server.test.mjs tests/ai-client.test.mjs
```

测试注入mock fetch，不调用真实付费模型，覆盖无Key、模型allowlist、Origin、请求大小、响应边界、上游错误脱敏、超时、静态路径与前端安全降级。`createServer({config,fetch,root})`用于隔离测试；导入server.mjs不会开启监听。实际供应商连通性和输出质量需要运营者配置新Key后另行验证；本轮测试不代表真实模型调用成功。
