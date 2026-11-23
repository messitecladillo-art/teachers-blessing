# 知学工作台 · EduForge Studio (v4.2)

面向课程学习与教学备课的全栈工作台，基于 FastAPI 与 React 19 + TypeScript + KaTeX 构建，覆盖系统建课、白板交互课堂、个人知识库与 7 大教学研习工坊。

## 核心功能模块

- **打造课程与即时协助**：按主题或上传讲义自动编排单元课程骨架、速查表与思维导图；支持「快速 / 标准」双档协同执行与步骤确认模式。
- **白板课堂**：分屏板书与流式对话追问，自动触发符号算式核验徽章；内置函数/三维曲线画板、SVG 批注画笔、多音色服务端语音导读及板书 Markdown 导出。
- **课程集市与课程空间**：支持「官方课程 / 专题教研集」双模式浏览加入；在课程空间内一键补充配套教学教案、演示课件、随堂测验并支持整课 ZIP 打包导出。
- **学习动态与日历规划**：持久化月历待办增删改、7 日复习计划自动入表、`.ics` 日历及复习打卡表导出，关联错题巩固小测。
- **个人知识库**：多格式讲义（PDF、DOCX、PPTX、LaTeX、HTML、Markdown、ZIP 等）自动拆章入库，支持全文检索、预览与课程联动生成。
- **7 大核心工坊**（左侧栏直接展开）：
  1. **错题与分步答疑**：渐进启发引导、分步推导核验、错题本掌握度追踪。
  2. **题库组卷与测验**：题库检索与策略组卷、在线限时作答批改、双版 Word 导出。
  3. **演示课件编辑器**：多主题幻灯片结构规划、画布内联文本编辑与原生 PPTX 导出。
  4. **教学设计编辑器**：分学段课型结构化教案编排、正副板书与分层练习一键导出。
  5. **结构导图与画板**：知识关系图自动布局、可编辑流程图导出及交互数学图形实验。
  6. **学科速查表**：2/3 栏高密度公式与易错反例一页纸排版，支持打印导出 PDF。
  7. **成绩脱敏分析**：本地成绩表敏感字段自动脱敏统计、分数段与知识点诊断图。

---

## 本地启动说明

### 1. 后端服务（`127.0.0.1:8008`）

需 Python 3.10+。配置至少一组模型接口环境变量后启动：

```bash
cd backend
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# 二选一配置接口密钥（亦可在页面「设置 -> 服务连接」中填写）
# Windows PowerShell:
$env:ANTHROPIC_API_KEY="your_api_key"
$env:ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
$env:EDUFORGE_DEFAULT_MODEL="deepseek-chat"

uvicorn main:app --host 127.0.0.1 --port 8008
```

首次启动会自动初始化本地目录及示范课程与演示数据，也可运行测试验证：

```bash
pytest tests/test_e2e_backend.py -v
```

### 2. 前端界面（`127.0.0.1:5173`）

需 Node.js 18+：

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

生产构建验证：

```bash
npm run build
```

---

## 开源组件声明

- 仓库 `vendor/ppt-master/` 目录集成了 [hugohe3/ppt-master](https://github.com/hugohe3/ppt-master)（MIT License），用于文档结构解析及原生 PowerPoint 文档生成与结构检查；完整版权及开源许可说明见 `vendor/ppt-master/skills/ppt-master/LICENSE`。为保持代码库精简，`.gitignore` 中已忽略 `vendor/ppt-master/docs/`，完整运行脚本与许可声明均完整保留。
