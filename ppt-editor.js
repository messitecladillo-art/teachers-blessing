/**
 * PPT Editor Engine
 * Full Vanilla JS Canvas & State Management for High Fidelity PPT Editing
 */

window.initFullPPTEngine = function(containerId, pptData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Deep clone data to avoid mutating original prematurely
    let state = JSON.parse(JSON.stringify(pptData));
    if (!state.slides) state.slides = [];
    
    // Setup container layout
    container.innerHTML = `
        <div style="width: 250px; background: #1e293b; display: flex; flex-direction: column; border-right: 1px solid #0f172a;">
            <div style="padding: 16px; color: #fff; font-weight: 800; font-size: 0.9rem; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
                <span>大纲视图 (Outline)</span>
                <span style="font-size:0.7rem; color:#94a3b8; font-weight:normal;">${state.slides.length + 1} 页</span>
            </div>
            <div id="ppt-editor-sidebar" style="flex: 1; overflow-y: auto; padding: 12px; gap: 12px; display: flex; flex-direction: column;"></div>
        </div>
        <div style="flex: 1; background: #e2e8f0; position: relative; display: flex; flex-direction: column;">
            
            <div style="height: 50px; background: #fff; border-bottom: 1px solid #cbd5e1; display: flex; justify-content: space-between; align-items: center; padding: 0 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); z-index: 10;">
                <div style="display:flex; align-items:center; gap: 16px;">
                    <button id="ppt-btn-add-img" style="background:transparent; border:1px solid #cbd5e1; border-radius:4px; padding:6px 12px; font-size:0.8rem; cursor:pointer; color:var(--ink); font-weight:600; transition:all 0.2s;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">
                        🖼️ 插入本地图片
                    </button>
                    <input type="file" id="ppt-img-upload" accept="image/*" style="display:none;">
                </div>
                <button id="ppt-btn-export" style="background:var(--primary); color:#fff; border:none; border-radius:6px; padding:8px 20px; font-weight:800; font-size:0.85rem; font-family:'Noto Sans SC'; cursor:pointer; box-shadow:0 4px 12px rgba(196,104,60,0.25); transition:all 0.3s; display:inline-flex; align-items:center; gap:6px;">
                    📥 打包源文件并下载 .pptx
                </button>
            </div>
            
            <div style="flex: 1; display: flex; justify-content: center; align-items: center; overflow: hidden; padding: 24px;">
                <div id="ppt-editor-canvas" style="box-shadow: 0 24px 48px rgba(0,0,0,0.15); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position:relative;"></div>
            </div>
            
            <!-- 悬浮工具条 -->
            <div id="ppt-floating-toolbar" style="position: absolute; display: none; background: #fff; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); border: 1px solid #e2e8f0; padding: 6px; z-index: 100; gap: 4px; align-items:center;">
                <select id="ppt-font-selector" style="border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 8px; font-size: 0.75rem; outline: none; cursor:pointer;">
                    <option value="">跟随系统字体</option>
                    <option value="Microsoft YaHei">微软雅黑</option>
                    <option value="SimSun">宋体</option>
                    <option value="SimHei">黑体</option>
                    <option value="KaiTi">楷体</option>
                    <option value="Arial">Arial</option>
                </select>
                <div style="width:1px; height:16px; background:#cbd5e1; margin:0 4px;"></div>
                <button style="border:none; background:transparent; font-size:0.8rem; cursor:pointer; padding:4px; border-radius:4px;" title="粗体">B</button>
            </div>
        </div>
    `;

    const sidebar = container.querySelector("#ppt-editor-sidebar");
    const canvasWrap = container.querySelector("#ppt-editor-canvas");
    const exportBtn = container.querySelector("#ppt-btn-export");
    const toolbar = container.querySelector("#ppt-floating-toolbar");
    const fontSelector = container.querySelector("#ppt-font-selector");
    const imgBtn = container.querySelector("#ppt-btn-add-img");
    const imgUpload = container.querySelector("#ppt-img-upload");
    
    let activeIndex = 0; // 0 = Cover, 1+ = Normal Slides
    let activeBlock = null;

    // Helper: Build Cover Slide HTML
    function buildCover(title, scale = 1) {
        return `
            <div style="width: ${960 * scale}px; height: ${540 * scale}px; background: #19323c; display: flex; flex-direction: column; justify-content: center; align-items: center; position: relative;">
                <h4 class="ppt-block-title" data-path="title" contenteditable="true" style="color:#ffffff; font-size:${44 * scale}px; font-weight:800; margin:0 0 ${16*scale}px 0; padding:0 ${32*scale}px; outline:none; text-align:center; border:2px dashed transparent; width:80%;" onfocus="this.style.borderColor='rgba(255,255,255,0.5)'" onblur="this.style.borderColor='transparent'">${title}</h4>
                <p style="color:#e8956a; font-size:${20 * scale}px; margin:0;">Teacher Service Hub / Agent Studio</p>
                ${renderImages(0, scale)}
            </div>
        `;
    }

    // Helper: Build Normal Slide HTML
    function buildSlide(slideData, sIdx, scale = 1) {
        let bulletsHtml = "";
        let bulletsArr = Array.isArray(slideData.bullets) ? slideData.bullets : [slideData.bullets || ""];
        bulletsArr.forEach((b, i) => {
            let ff = slideData.bulletFonts && slideData.bulletFonts[i] ? \`font-family:\${slideData.bulletFonts[i]}\` : "";
            bulletsHtml += \`<li class="ppt-block-bullet" data-path="bullets[\${i}]" contenteditable="true" style="margin-bottom:\${12*scale}px; line-height:1.5; outline:none; border:2px dashed transparent; border-radius:4px; \${ff}" onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='transparent'">\${b || '点击输入内容'}</li>\`;
        });

        let titleFf = slideData.titleFont ? \`font-family:\${slideData.titleFont}\` : "";

        return `
            <div style="width: ${960 * scale}px; height: ${540 * scale}px; background: #f4efe6; display: flex; flex-direction: column; position: relative;">
                <div style="background: #c4683c; height: ${114 * scale}px; width: 100%; display: flex; align-items: center; padding: 0 ${48 * scale}px; box-sizing: border-box;">
                    <h4 class="ppt-block-title" data-path="title" contenteditable="true" style="color:#ffffff; font-size:${32 * scale}px; font-weight:800; margin:0; outline:none; width:100%; white-space:nowrap; overflow:hidden; border:2px dashed transparent; transition:all 0.2s; ${titleFf}" onfocus="this.style.borderColor='rgba(255,255,255,0.5)'" onblur="this.style.borderColor='transparent'">${slideData.title || "空标题"}</h4>
                </div>
                <div style="flex: 1; padding: ${40 * scale}px ${48 * scale}px; overflow-y: auto;">
                    <ul style="color:#19323c; font-size:${22 * scale}px; padding-left:${24*scale}px; margin:0;">
                        ${bulletsHtml}
                    </ul>
                </div>
                ${renderImages(sIdx, scale)}
                <span style="position:absolute; bottom:${16*scale}px; right:${24*scale}px; font-size:${16*scale}px; color:#94a3b8;">${sIdx}</span>
            </div>
        `;
    }

    function renderImages(sIdx, scale) {
        let html = "";
        let imgs = sIdx === 0 ? state.coverImages : (state.slides[sIdx-1].images);
        if(!imgs) return "";
        imgs.forEach((img, i) => {
            // Default center if no coords
            let x = img.x !== undefined ? img.x * 96 : 300; // 1 unit ~ 96px in approx 10x ratio
            let y = img.y !== undefined ? img.y * 96 : 200;
            let w = img.w !== undefined ? img.w * 96 : 200;
            html += \`<img src="\${img.data}" style="position:absolute; left:\${x*scale}px; top:\${y*scale}px; width:\${w*scale}px; border:2px solid transparent; cursor:move;" />\`;
        });
        return html;
    }

    // Save current canvas state to memory
    function saveCanvasState() {
        if (!canvasWrap.firstElementChild) return;
        const blocks = canvasWrap.querySelectorAll('[contenteditable="true"]');
        blocks.forEach(b => {
             const path = b.getAttribute("data-path");
             const txt = b.innerText.trim();
             const ff = b.style.fontFamily;
             
             if (activeIndex === 0) {
                 if(path === "title") state.title = txt;
             } else {
                 let s = state.slides[activeIndex - 1];
                 if(path === "title") {
                     s.title = txt;
                     if(ff) s.titleFont = ff.replace(/['"]/g, '');
                 } else if (path.startsWith("bullets[")) {
                     const m = path.match(/bullets\\[(\\d+)\\]/);
                     if(m) {
                         let idx = parseInt(m[1]);
                         if(!Array.isArray(s.bullets)) s.bullets = [s.bullets];
                         s.bullets[idx] = txt;
                         if(!s.bulletFonts) s.bulletFonts = [];
                         if(ff) s.bulletFonts[idx] = ff.replace(/['"]/g, '');
                     }
                 }
             }
        });
    }

    function renderSidebar() {
        sidebar.innerHTML = "";
        const total = state.slides.length + 1;
        for(let i=0; i<total; i++) {
            let thumbHtml = i === 0 ? buildCover(state.title || "学术课件生成", 0.22) : buildSlide(state.slides[i-1], i, 0.22);
            let isAct = i === activeIndex;
            let div = document.createElement("div");
            div.style = \`cursor:pointer; border-radius:6px; overflow:hidden; border: 2px solid \${isAct ? 'var(--primary)' : 'transparent'}; box-shadow: 0 4px 6px rgba(0,0,0,0.3); opacity: \${isAct ? 1 : 0.6}; transition: all 0.2s;\`;
            div.innerHTML = \`<div style="pointer-events:none;">\${thumbHtml}</div><div style="background:#0f172a; padding:4px; text-align:center; color:#94a3b8; font-size:0.65rem;">\${i===0 ? '封面 (Cover)' : '幻灯片 ' + i}</div>\`;
            div.onclick = () => {
                saveCanvasState();
                activeIndex = i;
                renderSidebar();
                renderCanvas();
            };
            sidebar.appendChild(div);
        }
    }

    function renderCanvas() {
        canvasWrap.innerHTML = activeIndex === 0 ? buildCover(state.title || "学术课件生成", 0.85) : buildSlide(state.slides[activeIndex-1], activeIndex, 0.85);
        
        // Attach toolbar events
        const blocks = canvasWrap.querySelectorAll('[contenteditable="true"]');
        blocks.forEach(b => {
             b.addEventListener('focus', (e) => {
                 activeBlock = e.target;
                 const rect = e.target.getBoundingClientRect();
                 const containerRect = container.getBoundingClientRect();
                 toolbar.style.display = 'flex';
                 toolbar.style.left = (rect.left - containerRect.left) + 'px';
                 toolbar.style.top = (rect.top - containerRect.top - 40) + 'px';
                 
                 let ff = e.target.style.fontFamily.replace(/['"]/g, '');
                 fontSelector.value = ff || "";
             });
        });
    }

    // Canvas click outside hides toolbar
    canvasWrap.addEventListener('mousedown', (e) => {
        if(!e.target.hasAttribute("contenteditable")) {
            toolbar.style.display = 'none';
            activeBlock = null;
        }
    });

    // Font selection
    fontSelector.addEventListener('change', (e) => {
        if(activeBlock) {
            activeBlock.style.fontFamily = e.target.value;
            saveCanvasState();
        }
    });

    // Image Upload
    imgBtn.addEventListener('click', () => imgUpload.click());
    imgUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const b64 = ev.target.result;
            if(activeIndex === 0) {
                if(!state.coverImages) state.coverImages = [];
                state.coverImages.push({ data: b64, x: 2, y: 3, w: 2 });
            } else {
                let s = state.slides[activeIndex - 1];
                if(!s.images) s.images = [];
                s.images.push({ data: b64, x: 2, y: 2, w: 2 });
            }
            renderSidebar();
            renderCanvas();
        };
        reader.readAsDataURL(file);
    });

    // Export Logic
    exportBtn.addEventListener('click', () => {
        saveCanvasState();
        const finalBtnText = exportBtn.innerHTML;
        exportBtn.innerHTML = "⏳ 正在构建原生 .pptx...";
        exportBtn.disabled = true;
        
        try {
            // Re-map the state to PptxGenJS native format inside app.js if needed
            // But since generateRealPPT uses precisely Title, slides[].title, slides[].bullets
            // I will inject our new properties (font, images) directly into the pptData structure
            
            // Note: need to patch generateRealPPT in app.js slightly to read these, or we do it here.
            // Since generateRealPPT is globally accessible, we patch the jsonData before sending.
            window.generateRealPPT(state);
            
            setTimeout(() => {
                exportBtn.innerHTML = finalBtnText;
                exportBtn.disabled = false;
            }, 2000);
        } catch(err) {
            console.error(err);
            exportBtn.innerHTML = "❌ 导出失败";
        }
    });

    // Init
    renderSidebar();
    renderCanvas();
};
