# 教材原页预览接口

本机原PDF物理页渲染，用于原页与讲解对照。不会把OCR文字重新排版冒充原页，不调用模型，也不上传页面。只有客户端实际加载PNG成功后才可作为已显示预览；失败应提示用户打开原件。

## 接线

`createPagePreviewService({store,dataDir,render?})`来自`learning/page-preview-service.mjs`。工厂无启动读盘；父API先完成同源检查和会话鉴权，再调用`await service.handle(req,res,pathname,user)`，返回是否处理。关闭时调用`service.close()`中止活动与排队请求。

`GET /api/v1/textbooks/:id/pages/:page/preview?fileId=<当前来源文件>`返回`image/png`。页码是PDF物理页，非印刷页。响应包含`X-Page-Number`、`X-Page-Source: pdf-original-page`及`X-Page-Source-SHA256`，并设`no-store`、`nosniff`。错误为统一JSON，未登录由父API拒绝；越权404、无PDF404、页码非法400/不存在404、文件不匹配或来源改变409。只支持GET。

必须同时满足本人教材、activeFileId、同书最新未删PDF和查询fileId。新文件上传后，即使尚未解析，也不能继续混用旧文件页图。原件路径限受控UUID文件，验证文件大小、SHA与stat；排队后、渲染后和发送前再次核对来源。磁盘缓存不能绕过权限或原件变化检查。

## 固定预算

- 独立固定Node worker，256MiB V8堆、30秒，仅访问所选`getPage(n)`；禁eval/XFA与外部worker取资源。V8堆限制不等于原生RSS或操作系统沙箱。
- 保留PDF原排版，PNG最大1200×1800且总像素≤200万、文件≤6MiB。内嵌单图仍限1600万像素；被解析库删除的超大图会拒绝整页预览，不返回残缺成功页。
- 并发2、排队32，等待上限30秒；浏览器断开取消等待或终止当前worker。
- 私有磁盘缓存按SHA、物理页和渲染配置区分，LRU总额≤64MiB且≤32页；串行写入前清理、原子改名，重启恢复上限并清理本模块遗留临时文件。不在store中保存base64。

字体、坏PDF或资源超限仍可能导致预览失败，不承诺所有PDF像素级一致。Markdown没有PDF原页，保持诚实占位和原件入口。解析库固定版本的超图警告检测须随升级重新验证。

## 合成验证

`node --test tests/study-page-preview.test.mjs`通过普通账号HTTP验证自编三页PDF的第2页绿色、第3页蓝色，与封面第1页红色区分；检查页码、属主、当前文件、替换/晚到、SHA变化、缓存/重启与LRU、断开取消、队列溢出、超时、坏文件及真实18M像素嵌图阻断。测试只用自编PDF和临时独立数据，不读取真实教材或模型配置。

上述是后端HTTP和渲染证据，客户端对照布局、翻页、缩放与移动端仍需浏览器分项验收。
