# 建议profile：textbook-learning-local

这是新写的设计建议，非已激活上游profile。来源为本项目`study.css`已有视觉，不复制Mentrix品牌素材；只在需要说明知识结构/任务状态时使用，不为列表添加装饰图。

| 角色 | 建议值 |
|---|---|
| paper / paper-2 | `#faf9f6` / `#f0f2ed` |
| ink | `#24382d` |
| muted / soft | `#596654`，具体背景上复测对比度；不用界面浅灰替代图中文字 |
| accent / link | `#315c46` / `#315c46` |
| accent-tint | `rgba(49,92,70,.08)` |
| rule / rule-solid | `#e2e6de` / `#788176`，装饰线不能是唯一含义载体 |
| 标题字体 | Georgia、SimSun、serif |
| 中文节点 | Microsoft YaHei、system-ui、sans-serif，至少12px |
| 技术字段 | Consolas、ui-monospace、monospace，仅用于ID/协议/命令 |
| 字体来源 | system，不新增Google Fonts请求 |

优先三类：教材→来源页→知识点→讲解/练习用Data flow；queued/running/cancelled/failed/completed及来源失效用State；章节/知识点用Tree。实体关系是说明图，不把JSON集合画成已存在的关系数据库。

沿用上游的删除测试、至多9节点/12连接（超出拆图）、1–2个重点、正交连线、标签留白、无穿框线路、4px几何网格、SVG title/desc与局部横向滚动。中文标签按全角字宽预算，不能缩到不可读。完整语义须在静态/减少动效模式成立。

实际输出前须记录图类型、语义、尺寸、删减内容与有效token来源，并在浏览器检查中文字体回退、对比度、裁切和连接线。当前只导入参考与建议，没有制作、渲染或验收任何新图，也没有执行上游检查脚本。
