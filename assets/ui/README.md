# 界面素材

- `cover-fallback-v1.png`：本项目使用内置imagegen生成的通用教材占位封面背景；没有文字、出版机构或第三方书封。教材标题由原生HTML叠加，实际PDF封面优先。
- `auth-books-v1.png`：内置imagegen生成的透明版画插画，用户已明确认可其风格。用于登录页及适量空状态：奶油纸色、鼠尾草绿、细密刻线、书籍与植物；它是装饰素材，不作为实际教材封面或学习证据。原始透明通道保留。
- `fonts/SourceHanSerifCN-Heavy.otf`：Adobe官方思源宋体CN Heavy，来源为[官方SubsetOTF/CN](https://github.com/adobe-fonts/source-han-serif/blob/release/SubsetOTF/CN/SourceHanSerifCN-Heavy.otf)。原始二进制与版权元数据保留，许可为同目录`SourceHanSerif-OFL.txt`。
- UI视觉提案与成套页面为概念设计，示例内容不代表真实学习记录、实际检索结果或教学效果。界面生产代码使用SVG图标和原生可编辑控件。

占位背景生成提示要点：暖白纸纹、底部绿色数学等高曲线、顶部留白，无文字、无Logo、无第三方出版物身份。用途为`agent_ui`，内容分类为`conceptual`；完整生成提示及本地审查记录随项目设计源保存。上述素材未自动获准用于匿名竞赛提交。
