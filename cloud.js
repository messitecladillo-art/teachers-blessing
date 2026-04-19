/* ============================
   AIGC 云端智能体市场后台架构 (Supabase & LocalStorage)
   本模块用于处理：用户登录注册、创建专属 AIGC 工作流、以及从云端拉取出自定义 Agent。
   ============================ */

// ⚠️ 请在此处填写你在 Supabase 官网获取的项目密钥
const SUPABASE_URL = ""; 
const SUPABASE_ANON_KEY = ""; 

// ========== 1. 核心架构判定与初始化 ==========

let supabase = null;
let isCloudMode = false;
let currentUser = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  if (window.supabase) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    isCloudMode = true;
    console.log("⚡ 真实云后台 Supabase 已连接");
  } else {
    console.error("Supabase SDK 尚未加载成功！降级为本地游牧模式。");
  }
} else {
  console.warn("⚠️ 尚未配置 Supabase 密钥，当前处于【无后台本地体验模式】(数据仅保存在您当前浏览器的 LocalStorage 中)");
}

// 全局：存放抓取下来的自定义 Agent 库
window.customAgentCollection = [];

// ========== 2. 身份鉴权 (Auth) ==========

const btnLoginNav = document.getElementById("btn-login");
const btnLogoutNav = document.getElementById("btn-logout");
const userInfoNav = document.getElementById("user-info");
const authModal = document.getElementById("auth-modal");
const closeAuthModal = document.getElementById("close-auth-modal");
const authEmail = document.getElementById("auth-email");
const authPass = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const btnLoginSubmit = document.getElementById("auth-btn-login");
const btnSignupSubmit = document.getElementById("auth-btn-signup");

function updateAuthUI() {
  if (currentUser) {
    // 已登录
    btnLoginNav.classList.add("hidden");
    userInfoNav.classList.remove("hidden");
    btnLogoutNav.classList.remove("hidden");
    userInfoNav.textContent = `👋 ${currentUser.email.split("@")[0]} (云端模式)`;
  } else {
    // 未登录
    btnLoginNav.classList.remove("hidden");
    userInfoNav.classList.add("hidden");
    btnLogoutNav.classList.add("hidden");
    
    if(!isCloudMode) {
      btnLoginNav.textContent = "当前为本地游牧模式";
      btnLoginNav.disabled = true;
      btnLoginNav.style.opacity = 0.6;
    }
  }
}

// 检查现有会话
async function checkUserSession() {
  if (!isCloudMode) return;
  const { data, error } = await supabase.auth.getSession();
  if (data?.session) {
    currentUser = data.session.user;
    updateAuthUI();
  }
}

if(btnLoginNav) {
  btnLoginNav.addEventListener("click", () => {
    if(isCloudMode) authModal.classList.remove("hidden");
  });
}

if(closeAuthModal) {
  closeAuthModal.addEventListener("click", () => authModal.classList.add("hidden"));
}

if(btnLogoutNav) {
  btnLogoutNav.addEventListener("click", async () => {
    if(!isCloudMode) return;
    await supabase.auth.signOut();
    currentUser = null;
    updateAuthUI();
  });
}

if(btnLoginSubmit) {
  btnLoginSubmit.addEventListener("click", async () => {
    authError.textContent = "登录中...";
    if(!isCloudMode) return authError.textContent = "未配置后端，无法登录";
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail.value.trim(),
      password: authPass.value.trim(),
    });
    if(error) {
      authError.textContent = "账户或密码错误";
    } else {
      currentUser = data.user;
      authModal.classList.add("hidden");
      updateAuthUI();
    }
  });
}

if(btnSignupSubmit) {
  btnSignupSubmit.addEventListener("click", async () => {
    authError.textContent = "注册请求中...";
    if(!isCloudMode) return authError.textContent = "未配置后端，无法注册";
    const { data, error } = await supabase.auth.signUp({
      email: authEmail.value.trim(),
      password: authPass.value.trim(),
    });
    if(error) {
      authError.textContent = error.message;
    } else {
      authError.textContent = "✅ 注册成功！由于免费数据库限制，可能需要去您的邮箱点击一下验证链接，或者可以直接用刚刚的密码登录。";
      authError.style.color = "#2f6f61";
    }
  });
}

// ========== 3. Agent 创建引擎 (Database) ==========

const btnCreateAgent = document.getElementById("btn-create-agent");
const agentModal = document.getElementById("agent-modal");
const closeAgentModal = document.getElementById("close-agent-modal");
const submitAgentBtn = document.getElementById("submit-agent");

const fieldAgentName = document.getElementById("modal-agent-name");
const fieldAgentDesc = document.getElementById("modal-agent-desc");
const fieldAgentPrompt = document.getElementById("modal-agent-prompt");

if(btnCreateAgent) {
  btnCreateAgent.addEventListener("click", () => {
    agentModal.classList.remove("hidden");
  });
}

if(closeAgentModal) {
  closeAgentModal.addEventListener("click", () => {
    agentModal.classList.add("hidden");
  });
}

if(submitAgentBtn) {
  submitAgentBtn.addEventListener("click", async () => {
    const name = fieldAgentName.value.trim();
    const desc = fieldAgentDesc.value.trim();
    const prompt = fieldAgentPrompt.value.trim();
    
    if(!name || !prompt) {
      alert("抱歉，Agent 的名字和您的私有核心 prompt 是必填项！");
      return;
    }
    
    submitAgentBtn.disabled = true;
    submitAgentBtn.textContent = "上传链路中...";

    const newAgent = {
      id: "agent_" + Date.now(),
      name: name,
      desc: desc || "未提供简述",
      system_prompt: prompt,
      created_at: new Date().toISOString()
    };

    if(isCloudMode) {
      // 写入真实数据库
      // 注意：这需要您在 supabase 里建一张叫 custom_agents 的表
      try {
        const { error } = await supabase.from('custom_agents').insert([newAgent]);
        if(error) throw error;
      } catch(err) {
        alert("云端拦截：请先确立您是否已在 Supabase 建立了对应的 `custom_agents` 数据表结构。\n本地降级缓存已自动启动。");
        saveToLocal(newAgent);
      }
    } else {
      // 游牧模式写入本地
      saveToLocal(newAgent);
    }
    
    submitAgentBtn.textContent = "将其纳入引擎列阵";
    submitAgentBtn.disabled = false;
    agentModal.classList.add("hidden");
    
    // 清空
    fieldAgentName.value = "";
    fieldAgentDesc.value = "";
    fieldAgentPrompt.value = "";
    
    // 刷新全栈 UI 列表
    fetchAgentsAndRender();
  });
}

function saveToLocal(agent) {
  const existing = JSON.parse(localStorage.getItem('UGC_Agents') || '[]');
  existing.push(agent);
  localStorage.setItem('UGC_Agents', JSON.stringify(existing));
}

// ========== 4. 获取与渲染自定义工作流 ==========

async function fetchAgentsAndRender() {
  window.customAgentCollection = [];
  
  if (isCloudMode) {
    try {
      const { data, error } = await supabase.from('custom_agents').select('*').order('created_at', { ascending: false });
      if(!error && data) {
         window.customAgentCollection = data;
      }
    } catch(err) {
      console.warn("网络抓取失败，退回本地存储");
    }
  } 
  
  // 无论如何也把本地尝试加入进去 (应对演示无后端的窘境)
  const localAgents = JSON.parse(localStorage.getItem('UGC_Agents') || '[]');
  
  // 合并防倒灌
  const mergedIds = new Set(window.customAgentCollection.map(a => a.id));
  localAgents.forEach(la => {
    if(!mergedIds.has(la.id)) {
      window.customAgentCollection.push(la);
    }
  });

  renderDynamicAgents();
}

function renderDynamicAgents() {
  const listCont = document.getElementById("dynamic-agents-list");
  if(!listCont) return;
  
  listCont.innerHTML = "";
  
  window.customAgentCollection.forEach((agent) => {
    // 组装 HTML
    const btn = document.createElement("button");
    btn.className = "aigc-tab";
    // 这行极其关键，我们把动态id绑定到agent
    btn.dataset.agent = agent.id;
    btn.style.borderLeft = "4px solid #71b9a9"; // 新出的用不同颜色区分
    btn.style.backgroundColor = "rgba(113, 185, 169, 0.05)";
    
    btn.innerHTML = `
      <span class="tab-icon">✨</span>
      <div class="tab-text">
        <p class="tab-title">${agent.name} <span style="font-size:0.6rem; background:#71b9a9; color:white; padding:2px 4px; border-radius:4px; margin-left:4px">自建</span></p>
        <p class="tab-sub">${agent.desc}</p>
      </div>
    `;
    
    listCont.appendChild(btn);
  });
  
  // 注入完毕后，需要重新绑定一下左侧导航的高亮切换事件（我们在 app.js 里也写过，这里要补发）
  bindDynamicTabEvents();
}

function bindDynamicTabEvents() {
  const tabs = document.querySelectorAll('.aigc-tab');
  const input = document.getElementById('aigc-input');
  
  tabs.forEach(tab => {
    // 移除老监听器防止重复（最简单的做法是clone）
    const newTab = tab.cloneNode(true);
    tab.parentNode.replaceChild(newTab, tab);
    
    newTab.addEventListener('click', () => {
      document.querySelectorAll('.aigc-tab').forEach(t => t.classList.remove('active'));
      newTab.classList.add('active');
      
      const targetId = newTab.dataset.agent;
      
      // 我们通过自定义事件通知 app.js 换档
      const event = new CustomEvent('AgentSwitch', { detail: targetId });
      document.dispatchEvent(event);
      
      // 如果是我们刚渲染出的自定义Agent，帮它改一下输入框 placeholder
      const f_agent = window.customAgentCollection.find(a => a.id === targetId);
      if(f_agent && input) {
        input.placeholder = `调用私有工作流 / 请输入指令...`;
      }
    });
  });
}

// 首次拉取触发
document.addEventListener("DOMContentLoaded", () => {
  checkUserSession();
  fetchAgentsAndRender();
});
