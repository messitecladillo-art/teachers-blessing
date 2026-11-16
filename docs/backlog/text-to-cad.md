# 内置功能预留：Text to CAD

状态：**已登记，暂缓实现**。用户要求先保存为后续内置功能；当前优先级仍是 Mentrix 教材学习闭环。

上游：[earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad)，2026-11-16 固定参考提交 `2738524be8b30ec3d025d73b499fd2a6028af336`，MIT 许可。上游提供基于 Python / build123d / OpenCASCADE 的建模与预览工作流，以及 STEP、STL、GLB 等导出能力。

拟接入位置是教材知识点中的“制作教学模型”：教师或学习者描述几何体、零件或机构，生成可调整参数的三维模型，预览后导出，并把产物关联到知识点与学习笔记。自然语言描述、建模脚本、几何文件和截图分别保存版本及来源。

后续接入需先核对 Python/CAD 运行环境、查看器许可、后台任务隔离、文件格式与大小预算，再用自制模型验证生成、修改、预览和实际导出。复用前保留上游许可并记录固定版本。当前没有运行其安装脚本、注册其 MCP、安装本机 CAD 环境或发送任何用户教材。

模块登记在 `config/builtin-modules.json`，`enabled=false`。它尚未提供可用的 CAD 生成功能。
