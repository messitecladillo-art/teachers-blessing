/* ============================
   师范生成长驿站 — 前端逻辑 V2
   ============================ */

// ===== 工具函数 =====
async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const fallback = "请求失败，请稍后再试";
    try {
      const err = await res.json();
      throw new Error(err.error || fallback);
    } catch (e) {
      throw new Error(e.message || fallback);
    }
  }
  return res.json();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// ===== 渲染函数 =====
function renderQuickLinks(links) {
  const box = document.getElementById("quick-links");
  box.innerHTML = "";
  links.forEach((link) => {
    const a = el("a", "nav-chip", link);
    a.href = "#services";
    box.appendChild(a);
  });
}

function renderStats(stats) {
  const box = document.getElementById("hero-stats");
  box.innerHTML = "";
  stats.forEach((item) => {
    const card = el("article", "stat-card");
    card.append(
      el("div", "stat-value", item.value),
      el("p", "item-subtitle", item.label)
    );
    box.appendChild(card);
  });
}

function renderServices(services) {
  const box = document.getElementById("service-grid");
  box.innerHTML = "";

  const icons = ["📋", "🏫", "💼", "📚"];
  services.forEach((svc, i) => {
    const card = el("article", "service-card");
    const iconEl = el("div", "service-icon", icons[i] || "🔹");
    card.append(
      iconEl,
      el("span", "service-tag", svc.tag),
      el("h4", "item-title", svc.title),
      el("p", "item-description", svc.description)
    );
    box.appendChild(card);
  });
}

function renderAnnouncements(announcements) {
  const list = document.getElementById("announcement-list");
  const highlight = document.getElementById("announcement-highlights");
  list.innerHTML = "";
  highlight.innerHTML = "";

  announcements.forEach((a, i) => {
    const date = new Date(a.date).toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });

    const item = el("article", "stack-item");
    const meta = el("span", "meta", a.category);
    const title = el("h4", "item-title", a.title);
    const sub = el("p", "item-subtitle", date);
    item.append(meta, title, sub);
    list.appendChild(item);

    if (i < 3) {
      const hi = el("li", "highlight-item");
      hi.append(
        el("h4", "item-title", a.title),
        el("p", "item-subtitle", `${a.category} · ${date}`)
      );
      highlight.appendChild(hi);
    }
  });
}

function renderEvents(events) {
  const box = document.getElementById("event-list");
  box.innerHTML = "";
  events.forEach((evt) => {
    const item = el("article", "stack-item");
    item.append(
      el("h4", "item-title", evt.title),
      el("p", "item-subtitle", `${evt.time} · ${evt.location}`)
    );
    box.appendChild(item);
  });
}

function renderResources(resources) {
  const box = document.getElementById("resource-grid");
  box.innerHTML = "";
  resources.forEach((res) => {
    const card = el("article", "resource-card");
    card.append(
      el("span", "resource-type", res.type),
      el("h4", "item-title", res.title),
      el("p", "item-description", "点击获取资源，后续可接入真实下载与权限控制。")
    );
    box.appendChild(card);
  });
}

function renderMessages(messages) {
  const box = document.getElementById("message-list");
  box.innerHTML = "";

  if (!messages.length) {
    box.appendChild(el("p", "empty-state", "暂时还没有留言记录。"));
    return;
  }

  messages.forEach((msg) => {
    const item = el("article", "message-item");
    item.append(
      el("h4", "item-title", `${msg.topic} · ${msg.name}`),
      el("p", "item-subtitle", `${msg.role} · ${msg.createdAt.replace("T", " ")}`),
      el("p", "item-description", msg.message)
    );
    box.prepend(item);
  });
}

// 模拟本地内存留言池（用于前端无后端展示）
window.mockMessages = [];

// ===== 数据加载 =====
async function loadContent() {
  const content = await fetchJson("./data/content.json");
  document.getElementById("site-name").textContent = content.site.name;
  document.getElementById("site-subtitle").textContent = content.site.subtitle;

  renderQuickLinks(content.quickLinks);
  renderStats(content.site.heroStats);
  renderServices(content.services);
  renderAnnouncements(content.announcements);
  renderEvents(content.events);
  renderResources(content.resources);
}

async function loadMessages() {
  // 读取静态的空消息数组，并将内存里的追加进去
  const staticMessages = await fetchJson("./data/messages.json").catch(() => []);
  const allMessages = [...staticMessages, ...window.mockMessages].slice(-3).reverse();
  renderMessages(allMessages);
}

// ===== 表单 =====
function setupForm() {
  const form = document.getElementById("contact-form");
  const status = document.getElementById("form-status");
  const btn = document.getElementById("submit-btn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "正在提交...";
    status.className = "form-status";
    btn.disabled = true;

    const data = Object.fromEntries(new FormData(form).entries());

    try {
      // 模拟网络请求延迟
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // 构造留言对象存入内存
      const newMsg = {
        id: Date.now(),
        name: data.name.trim(),
        role: data.role,
        topic: data.topic.trim(),
        message: data.message.trim(),
        createdAt: new Date().toISOString().slice(0,19)
      };
      
      window.mockMessages.push(newMsg);
      form.reset();
      
      status.textContent = "✓ 提交成功！此版本为静态演示，留言仅在当前页面可见。";
      await loadMessages();
    } catch (err) {
      status.textContent = "提交失败，请重试";
      status.className = "form-status error";
    } finally {
      btn.disabled = false;
    }
  });
}

// ===== Scroll Reveal =====
function setupScrollReveal() {
  const targets = document.querySelectorAll("[data-reveal]");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
  );
  targets.forEach((t) => observer.observe(t));
}

// ===== Back to Top =====
function setupBackToTop() {
  const btn = document.getElementById("back-to-top");
  window.addEventListener("scroll", () => {
    btn.classList.toggle("visible", window.scrollY > 400);
  }, { passive: true });
  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// ===== 悬浮的 LongcatAI 助手核心逻辑 =====
function setupAIAssistant() {
  const toggleBtn = document.getElementById("ai-chat-toggle");
  const closeBtn = document.getElementById("ai-chat-close");
  const chatWindow = document.getElementById("ai-chat-window");
  const msgBox = document.getElementById("ai-chat-messages");
  const form = document.getElementById("ai-chat-input-form");
  const input = document.getElementById("ai-chat-input");
  const sendBtn = document.getElementById("ai-chat-send");
  
  let isChatOpen = false;
  
  // ==========================================
  // OpenRouter 接入配置 
  const AI_API_URL = "https://openrouter.ai/api/v1/chat/completions"; 
  const AI_API_KEY = "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";
  const AI_MODEL_NAME = "google/gemini-2.0-flash-exp:free"; // OpenRouter上的限免顶配大模型
  // ==========================================

  // 为模型写入系统设定
  let chatHistory = [
    { role: "system", content: "你是一个温柔、专业、有求必应的师范生成长助手 LongcatAI。你在网页右下角进行回复，请不要回复过于冗长的答案，使用纯文本回答为主。" }
  ];

  toggleBtn.addEventListener("click", () => {
    isChatOpen = !isChatOpen;
    chatWindow.classList.toggle("hidden", !isChatOpen);
    if(isChatOpen) input.focus();
  });

  closeBtn.addEventListener("click", () => {
    isChatOpen = false;
    chatWindow.classList.add("hidden");
  });

  function appendChatRow(text, isUser = false) {
    const el = document.createElement("div");
    el.className = isUser ? "msg-user" : "msg-ai";
    el.textContent = text;
    msgBox.appendChild(el);
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  function toggleLoading(show) {
    if (show) {
      const el = document.createElement("div");
      el.className = "msg-ai msg-loading-box";
      el.innerHTML = '<div class="msg-loading"><span></span><span></span><span></span></div>';
      msgBox.appendChild(el);
      msgBox.scrollTop = msgBox.scrollHeight;
    } else {
      const el = msgBox.querySelector(".msg-loading-box");
      if (el) el.remove();
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if(!text) return;

    appendChatRow(text, true);
    input.value = "";
    sendBtn.disabled = true;
    chatHistory.push({ role: "user", content: text });
    
    toggleLoading(true);
    
    try {
      const res = await fetch(AI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${AI_API_KEY}`,
          "HTTP-Referer": window.location.href, // OpenRouter 鉴权需要
          "X-Title": "老师一站式服务平台"       // OpenRouter 统计需要
        },
        body: JSON.stringify({
          model: AI_MODEL_NAME,
          messages: chatHistory,
          temperature: 0.7
        })
      });

      if(!res.ok) throw new Error(`请求报错（代码 ${res.status}）`);

      const data = await res.json();
      toggleLoading(false);

      const aiReply = data.choices && data.choices[0] && data.choices[0].message.content 
                      ? data.choices[0].message.content 
                      : "糟糕，没收到正确格式的回复呀。";
                      
      appendChatRow(aiReply, false);
      chatHistory.push({ role: "assistant", content: aiReply });
      
    } catch(err) {
      toggleLoading(false);
      appendChatRow(`❌ 无法连接到大模型。\n原因可能是：\n1. LongcatAI 的默认调用地址不同\n2. 浏览器拦截了跨域访问 (CORS)\n错误详情: ${err.message}`, false);
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });
}

// ===== 背景粒子 =====
function setupParticles() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let width, height, particles;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function createParticles() {
    // 降低粒子密度和上限
    const count = Math.floor((width * height) / 55000);
    particles = Array.from({ length: Math.min(count, 30) }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.5 + 0.8,
      dx: (Math.random() - 0.5) * 0.15, // 减缓速度
      dy: (Math.random() - 0.5) * 0.15,
      opacity: Math.random() * 0.3 + 0.1,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    particles.forEach((p) => {
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(196, 104, 60, ${p.opacity})`;
      ctx.fill();
    });

    // 连线
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const distSq = dx * dx + dy * dy;
        // 降低连线距离(原本130 -> 100)，直接比平方代替Math.sqrt，大幅降低双循环中CPU开销
        if (distSq < 10000) { 
          const dist = Math.sqrt(distSq);
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(47, 111, 97, ${0.08 * (1 - dist / 100)})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  resize();
  createParticles();
  draw();
  window.addEventListener("resize", () => {
    resize();
    createParticles();
  });
}

// ===== 启动 =====
async function bootstrap() {
  setupParticles();
  setupScrollReveal();
  setupBackToTop();
  setupAIAssistant(); // 启动 AI 助手

  try {
    await Promise.all([loadContent(), loadMessages()]);
    setupForm();
  } catch (err) {
    const status = document.getElementById("form-status");
    status.textContent = "页面初始化失败，请检查后端是否启动。";
    status.className = "form-status error";
    console.error(err);
  }
}

bootstrap();
