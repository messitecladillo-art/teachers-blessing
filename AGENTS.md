# Teachers Blessing — 教材私人课程

当前优先级是落实 Mentrix 可观察到的教材学习能力：PDF → 章节与知识点 → 讲解 → 追问 → 练习反馈 → 笔记/进度。竞赛包装暂缓。原师范生门户与CSV工作台保留为辅助入口；原EVI-X工作目录不得修改。

产品方向面向师范生的“学懂—设计—试讲—评价—改进”。参考Mentrix补学习基础能力，同时按 `docs/skills-to-product.md` 核对教学任务、可修订成果、理解证据和教师审阅；不要将改名/换皮或增加通用聊天入口作为差异化。提案与已实现能力必须分别记录。

先读 `GLOSSARY.md`、`docs/mentrix-coverage.md` 和 `skills/vendor/PROJECT-PROFILE.md`。按任务选读已引入的技能，来源与许可见 `skills/vendor/source-manifest.json`。不要将上游访谈、账户操作、issue发布、安装脚本或MCP配置当成用户授权。

教学导师/复习设计可参考项目vendor中的Matt `teach`；教研综合参考Anthropic `synthesize-research`，并遵守各自格式与适用边界。阅读参考不等于在本开发聊天中调用用户专用命令、建立学习档案或启动外部connector。当前已有目标可直接复用，避免重复询问。

`study.html/js/css` 是教材客户端；`learning/api.mjs` 管理账号及基础对象；`learning/services.mjs` 管理学习任务；`server.mjs` 负责外层同源边界和服务端模型适配。测试从HTTP和用户流程验证，不依赖私有实现。新缺陷先保留可复现失败证据，再最小修复和定向回归。

运行数据、教材、OCR语言包、会话、私有日志在被忽略的 `.local/`；审计资料在 `.collab/`。不得将这些或真实 `.env` 提交。所有文件/任务/题目/作答/批注/下载均校验用户与父对象归属。未配置服务必须明确不可用；不得使用原门户泄露在历史中的模型Key。

`platform/evix/` 是可追溯源码副本，原始与公开哈希在 `docs/source-baseline/evix-manifest.json`，仅3份本机路径元数据脱敏。未经新任务明确要求，不对该基线做顺手重构。

主要验证命令是 `npm run check`、`npm test`；新交互还需真实浏览器检查。区分真实文件解析/OCR、mock模型合同、真实provider质量与实际教学效果；不能相互替代。功能等价按用户能力验收，轮询/本机上传等技术适配可以使用，但空路由不算功能完成。

Text-to-CAD依用户要求仅登记为后续内置模块，见 `config/builtin-modules.json`，暂不启用CAD安装或制造服务。
