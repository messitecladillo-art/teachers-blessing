/**
 * PPT Editor Engine
 * Full Vanilla JS Canvas & State Management for High Fidelity PPT Editing
 */

const teachingPPTFonts = new Set(['', 'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'Arial']);
const teachingPPTMaxImageBytes = 2 * 1024 * 1024;
function teachingPPTEscape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function teachingPPTFont(value) {
    const text = typeof value === 'string' ? value.replace(/['"]/g, '').trim() : '';
    return teachingPPTFonts.has(text) ? text : '';
}
function teachingPPTText(value, max) {
    return (typeof value === 'string' || typeof value === 'number' ? String(value) : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}
function teachingPPTFinite(value, fallback, min, max) {
    const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : min));
}
function teachingPPTImageInfo(value) {
    if (typeof value !== 'string' || value.length > Math.ceil(teachingPPTMaxImageBytes / 3) * 4 + 50) return null;
    const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
    if (!match || match[2].length % 4) return null;
    let raw;
    try { raw = window.atob(match[2]); } catch (_) { return null; }
    if (!raw.length || raw.length > teachingPPTMaxImageBytes) return null;
    const b = i => raw.charCodeAt(i), le16 = i => b(i) | b(i+1) << 8, be16 = i => b(i) << 8 | b(i+1);
    const be32 = i => (b(i)*0x1000000 + (b(i+1)<<16 | b(i+2)<<8 | b(i+3))) >>> 0, le24 = i => b(i) | b(i+1)<<8 | b(i+2)<<16;
    let width = 0, height = 0;
    const mime = match[1].toLowerCase();
    if (mime === 'png' && raw.length >= 24 && raw.slice(0,8) === '\x89PNG\r\n\x1a\n' && raw.slice(12,16) === 'IHDR') {
        width = be32(16); height = be32(20);
    } else if (mime === 'gif' && raw.length >= 10 && /^GIF8[79]a/.test(raw)) {
        width = le16(6); height = le16(8);
    } else if (mime === 'jpeg' && raw.length >= 12 && b(0) === 255 && b(1) === 216) {
        let offset = 2;
        while (offset + 8 < raw.length && offset < 65536) {
            if (b(offset) !== 255) { offset++; continue; }
            while (b(offset) === 255) offset++;
            const marker = b(offset++);
            if (marker === 217 || marker === 218) break;
            if (marker === 1 || marker >= 208 && marker <= 215) continue;
            const size = be16(offset);
            if (size < 2 || offset + size > raw.length) break;
            if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { height = be16(offset+3); width = be16(offset+5); break; }
            offset += size;
        }
    } else if (mime === 'webp' && raw.length >= 30 && raw.slice(0,4) === 'RIFF' && raw.slice(8,12) === 'WEBP') {
        const kind = raw.slice(12,16);
        if (kind === 'VP8X') { width = 1 + le24(24); height = 1 + le24(27); }
        else if (kind === 'VP8L' && b(20) === 47) { width = 1 + ((b(21)|b(22)<<8)&0x3fff); height = 1 + ((b(22)>>6|b(23)<<2|b(24)<<10)&0x3fff); }
        else if (kind === 'VP8 ' && raw.slice(23,26) === '\x9d\x01\x2a') { width = le16(26)&0x3fff; height = le16(28)&0x3fff; }
    }
    return width > 0 && height > 0 && width <= 4096 && height <= 4096 && width*height <= 16000000 ? {width, height, bytes:raw.length} : null;
}
function teachingPPTNormalize(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    let textBudget = 64000, imageBudget = 12*1024*1024;
    const text = (value, max) => { const result = teachingPPTText(value, Math.min(max,textBudget)); textBudget -= result.length; return result; };
    const images = values => (Array.isArray(values) ? values.slice(0,4) : []).flatMap(image => {
        if (!image || typeof image !== 'object' || typeof image.data !== 'string' || image.data.length > imageBudget) return [];
        const info = teachingPPTImageInfo(image.data);
        if (!info) return [];
        imageBudget -= image.data.length;
        const w = teachingPPTFinite(image.w, 2, .25, 10), h = teachingPPTFinite(image.h, Math.min(5.625,w*info.height/info.width), .25, 5.625);
        return [{data:image.data, x:teachingPPTFinite(image.x,0,0,10-w), y:teachingPPTFinite(image.y,0,0,5.625-h), w, h}];
    });
    return {title:text(source.title,180), titleFont:teachingPPTFont(source.titleFont), coverImages:images(source.coverImages), slides:(Array.isArray(source.slides)?source.slides.slice(0,29):[]).map(value => {
        const slide = value && typeof value === 'object' ? value : {}, bullets = Array.isArray(slide.bullets)?slide.bullets.slice(0,12):[typeof slide.bullets==='string'?slide.bullets:''];
        return {title:text(slide.title,180),titleFont:teachingPPTFont(slide.titleFont),bullets:bullets.map(item=>text(item,600)),bulletFonts:bullets.map((_,i)=>teachingPPTFont(Array.isArray(slide.bulletFonts)?slide.bulletFonts[i]:'')),images:images(slide.images)};
    })};
}
window.TeachingPPTUtils = Object.freeze({normalizeData:teachingPPTNormalize,imageInfo:teachingPPTImageInfo,safeFont:teachingPPTFont});

window.initFullPPTEngine = function(containerId, pptData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Bounded copy: model/user values remain text, not trusted rich HTML.
    let state = teachingPPTNormalize(pptData);
    
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
                    <input type="file" id="ppt-img-upload" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none;">
                </div>
                <button id="ppt-btn-export" style="background:var(--primary); color:#fff; border:none; border-radius:6px; padding:8px 20px; font-weight:800; font-size:0.85rem; font-family:'Noto Sans SC'; cursor:pointer; box-shadow:0 4px 12px rgba(196,104,60,0.25); transition:all 0.3s; display:inline-flex; align-items:center; gap:6px;">
                    📥 打包源文件并下载 .pptx
                </button>
            </div>
            
            <div id="ppt-editor-notice" role="status" aria-live="polite" style="padding:6px 16px;font-size:12px;color:#475569;">编辑大纲最多30页（含封面）、每页12要点；标题180字、单要点600字、总文字64000字，超出会裁剪，请核对。图片单张≤2MB、边长≤4096px。导出时长内容自动续页。</div>
            <div style="flex: 1; display: flex; justify-content: center; align-items: center; overflow: auto; padding: 24px;">
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
    const notice = container.querySelector('#ppt-editor-notice');
    const notify = (message, error=false) => { notice.textContent=message; notice.style.color=error?'#a82828':'#475569'; notice.setAttribute('role',error?'alert':'status'); };
    if(Array.isArray(pptData && pptData.slides) && pptData.slides.length>29) notify('超出页数的内容已裁剪；最多30页（含封面），请检查后导出。');
    
    let activeIndex = 0; // 0 = Cover, 1+ = Normal Slides
    let activeBlock = null;

    // Helper: Build Cover Slide HTML
    function buildCover(title, scale = 1) {
        return `
            <div style="width: ${960 * scale}px; height: ${540 * scale}px; background: #19323c; display: flex; flex-direction: column; justify-content: center; align-items: center; position: relative;">
                <h4 class="ppt-block-title" data-path="title" contenteditable="true" style="color:#ffffff; font-size:${44 * scale}px; font-weight:800; margin:0 0 ${16*scale}px 0; padding:0 ${32*scale}px; outline:none; text-align:center; border:2px dashed transparent; width:80%;font-family:${teachingPPTFont(state.titleFont)};" onfocus="this.style.borderColor='rgba(255,255,255,0.5)'" onblur="this.style.borderColor='transparent'">${teachingPPTEscape(title)}</h4>
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
            let ff = `font-family:${teachingPPTFont(slideData.bulletFonts && slideData.bulletFonts[i])}`;
            bulletsHtml += `<li class="ppt-block-bullet" data-path="bullets[${i}]" contenteditable="true" style="margin-bottom:${12*scale}px; line-height:1.5; outline:none; border:2px dashed transparent; border-radius:4px; ${ff}" onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='transparent'">${teachingPPTEscape(b || '点击输入内容')}</li>`;
        });

        let titleFf = `font-family:${teachingPPTFont(slideData.titleFont)}`;

        return `
            <div style="width: ${960 * scale}px; height: ${540 * scale}px; background: #f4efe6; display: flex; flex-direction: column; position: relative;">
                <div style="background: #c4683c; height: ${114 * scale}px; width: 100%; display: flex; align-items: center; padding: 0 ${48 * scale}px; box-sizing: border-box;">
                    <h4 class="ppt-block-title" data-path="title" contenteditable="true" style="color:#ffffff; font-size:${32 * scale}px; font-weight:800; margin:0; outline:none; width:100%; white-space:nowrap; overflow:hidden; border:2px dashed transparent; transition:all 0.2s; ${titleFf}" onfocus="this.style.borderColor='rgba(255,255,255,0.5)'" onblur="this.style.borderColor='transparent'">${teachingPPTEscape(slideData.title || "空标题")}</h4>
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
            const x = img.x * 96, y = img.y * 96, w = img.w * 96, h = img.h * 96;
            html += `<img alt="插入的教学图片" src="${teachingPPTEscape(img.data)}" style="position:absolute; left:${x*scale}px; top:${y*scale}px; width:${w*scale}px;height:${h*scale}px;object-fit:contain; border:2px solid transparent;" />`;
        });
        return html;
    }

    // Save current canvas state to memory
    function saveCanvasState() {
        if (!canvasWrap.firstElementChild) return;
        const blocks = canvasWrap.querySelectorAll('[contenteditable="true"]');
        blocks.forEach(b => {
             const path = b.getAttribute("data-path");
             const txt = teachingPPTText(b.innerText === undefined ? b.textContent : b.innerText, path === 'title' ? 180 : 600).trim();
             const ff = teachingPPTFont(b.style.fontFamily);
             
             if (activeIndex === 0) {
                 if(path === "title") { state.title = txt; state.titleFont = ff; }
             } else {
                 let s = state.slides[activeIndex - 1];
                 if(path === "title") {
                     s.title = txt;
                     s.titleFont = ff;
                 } else if (path.startsWith("bullets[")) {
                     const m = path.match(/^bullets\[(\d+)\]$/);
                     if(m && Number(m[1]) < 12 && Number(m[1]) < s.bullets.length) {
                         let idx = parseInt(m[1]);
                         if(!Array.isArray(s.bullets)) s.bullets = [s.bullets];
                         s.bullets[idx] = txt;
                         if(!s.bulletFonts) s.bulletFonts = [];
                         s.bulletFonts[idx] = ff;
                     }
                 }
             }
        });
        state = teachingPPTNormalize(state);
    }

    function renderSidebar() {
        sidebar.innerHTML = "";
        const total = state.slides.length + 1;
        for(let i=0; i<total; i++) {
            let thumbHtml = i === 0 ? buildCover(state.title || "学术课件生成", 0.22) : buildSlide(state.slides[i-1], i, 0.22);
            let isAct = i === activeIndex;
            let div = document.createElement("div");
            div.style = `cursor:pointer; border-radius:6px; overflow:hidden; border: 2px solid ${isAct ? 'var(--primary)' : 'transparent'}; box-shadow: 0 4px 6px rgba(0,0,0,0.3); opacity: ${isAct ? 1 : 0.6}; transition: all 0.2s;`;
            div.innerHTML = `<div style="pointer-events:none;">${thumbHtml}</div><div style="background:#0f172a; padding:4px; text-align:center; color:#94a3b8; font-size:0.65rem;">${i===0 ? '封面 (Cover)' : '幻灯片 ' + i}</div>`;
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
             b.addEventListener('paste', event => {
                 event.preventDefault();
                 const max = b.dataset.path === 'title' ? 180 : 600;
                 const text = teachingPPTText(event.clipboardData && event.clipboardData.getData('text/plain'), max);
                 const selection = window.getSelection();
                 if(selection && selection.rangeCount && b.contains(selection.getRangeAt(0).commonAncestorContainer)) {
                     const range = selection.getRangeAt(0); range.deleteContents();
                     const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
                 } else b.appendChild(document.createTextNode(text));
                 b.textContent = teachingPPTText(b.textContent, max);
                 saveCanvasState();
             });
             b.addEventListener('drop', event => event.preventDefault());
             b.addEventListener('input', event => {
                 if(event.isComposing) return;
                 const max = b.dataset.path === 'title' ? 180 : 600;
                 if(b.children.length || b.textContent.length > max) b.textContent = teachingPPTText(b.textContent,max);
             });
             b.addEventListener('focus', (e) => {
                 activeBlock = e.target;
                 const rect = e.target.getBoundingClientRect();
                 const containerRect = container.getBoundingClientRect();
                 toolbar.style.display = 'flex';
                 toolbar.style.left = (rect.left - containerRect.left) + 'px';
                 toolbar.style.top = (rect.top - containerRect.top - 40) + 'px';
                 
                 let ff = teachingPPTFont(e.target.style.fontFamily);
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
            activeBlock.style.fontFamily = teachingPPTFont(e.target.value);
            saveCanvasState();
        }
    });

    // Image Upload
    imgBtn.addEventListener('click', () => imgUpload.click());
    imgUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if(!file) return;
        saveCanvasState(); const targetIndex = activeIndex;
        imgBtn.disabled = true;
        try {
            if(!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type) || file.size <= 0 || file.size > teachingPPTMaxImageBytes) throw new Error('请选择不超过2MB的PNG/JPEG/GIF/WebP图片。');
            const b64 = await new Promise((resolve,reject) => {
                const reader = new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error('图片文件读取失败。')); reader.readAsDataURL(file);
            });
            const info = teachingPPTImageInfo(b64);
            if(!info) throw new Error('图片格式或尺寸不符合要求；边长≤4096px、总像素≤1600万。');
            await new Promise((resolve,reject) => {
                const probe = new Image();
                probe.onload=()=>{ const valid=probe.naturalWidth===info.width && probe.naturalHeight===info.height; probe.src=''; valid?resolve():reject(new Error('图片实际尺寸与文件头不一致。')); };
                probe.onerror=()=>reject(new Error('浏览器无法解码这张图片。')); probe.src=b64;
            });
            const images = targetIndex===0?state.coverImages:state.slides[targetIndex-1].images;
            if(images.length>=4) throw new Error('每页最多插入4张图片。');
            const allImages=state.coverImages.concat(...state.slides.map(slide=>slide.images));
            if(allImages.reduce((total,image)=>total+image.data.length,0)+b64.length>12*1024*1024) throw new Error('课件图片总量已达上限，请压缩图片。');
            images.push({data:b64,x:2,y:2,w:2,h:Math.min(3.625,2*info.height/info.width)});
            state=teachingPPTNormalize(state); renderSidebar(); renderCanvas(); notify('图片已插入。');
        } catch(error) { notify(error && error.message?error.message:'图片插入失败。',true); }
        finally { imgBtn.disabled=false; imgUpload.value=''; }
    });

    // Export Logic
    exportBtn.addEventListener('click', async () => {
        if(exportBtn.disabled) return;
        saveCanvasState();
        const finalBtnText = exportBtn.textContent;
        exportBtn.textContent = "⏳ 正在构建原生 .pptx...";
        exportBtn.disabled = true;
        
        try {
            if(typeof window.generateRealPPT!=='function') throw new Error('PPT导出模块尚未就绪，请重新加载页面。');
            await window.generateRealPPT(teachingPPTNormalize(state));
            notify('PPT导出流程已完成，请在浏览器下载列表核对文件。');
        } catch(err) {
            notify('导出失败：'+(err && err.message?err.message:'未知导出错误，请重试。'),true);
        } finally { exportBtn.textContent=finalBtnText; exportBtn.disabled=false; }
    });

    // Init
    renderSidebar();
    renderCanvas();
};
