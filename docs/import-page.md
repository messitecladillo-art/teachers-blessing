# 原生整书导入页

`/textbook/:bookId/import` 显示当前账户教材的实际导入记录，复用原有整书服务。页面顶部为目录识别、知识点整理、讲义准备三个步骤；左侧为当前PDF物理第一页封面或文字占位及真实目录；中间呈现实际章节、来源页数、任务状态和先学入口；右侧保留处理范围、讲义、识别语言、公开补充与累计请求上限。

“全书就绪”仍由原有状态规则确定。没有可靠目录、来源部分缺字、预算暂停及失败会显示对应提示，不用固定页块或假百分比代替真实章节。目录核对按钮返回教材的已有人工目录入口。先学按钮进入已保存且可学习的真实章节。

## 接线

```js
const importer = StudyImport.install({ api, getContext, notify, navigate, onUpdate });
await importer.mount(host, bookId); // 原生全页，不弹出dialog
importer.unmount();               // 离开页面；不取消服务端任务
await importer.open(bookId);      // 原有弹窗兼容
await importer.start(bookId, options); // 原有上传流程兼容，仍显示弹窗
importer.contextChanged();        // 账户、epoch或路由改变时调用
importer.dispose();               // 销毁控制器和本地计时器
```

全页内部提交复用同一执行逻辑，保留在当前页。组件只有一个outlet，移入host或dialog，不复制第二套ID。请求及元数据带视图、epoch和请求序号约束；旧页迟到响应不能重绘新host。关闭页面只释放可见视图，已安装控制器可继续读取后台状态；销毁实例会清除本地轮询，不发送取消任务请求。

公开补充选项为 `externalResearch:'auto'|'off'`。默认配置可用时检索，关闭后仅用教材；`/config/public` 明确未配时显示跳过提示。此选项不授予发送教材原文或笔记的权限。显示的课程、研究与讲义均来自实际服务记录，不把页面设计稿中的示例条目作为成果。

## 验证边界

`tests/study-import-page.test.cjs` 使用合成DOM和注入API检查：单outlet、全页提交、公开补充选项、保存选项回显、关闭不取消、epoch迟到元数据及轮询、真实目录/章入口、封面端点、账户切换和旧start兼容。配合原 `study-import-client.test.cjs` 的11个进度合同，共20项通过。

DOM seam不检验真实布局、焦点或屏幕阅读器。页面样式依据批准稿03的三列结构和画面采样色值；接线后的真实浏览器、1586×992图稿对照及窄屏仍需独立验收，不能由本轮单测声称已100%视觉还原。
