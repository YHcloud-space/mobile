// ==================== 全局状态 ====================
let currentLine = 'C';
let selectedBrandId = null;
let selectedSpecId = null;

// 原始数据缓存
let brandsData = [];
let specsData = [];
let materialsData = [];
let localVersion = 0;

// ==================== 红点更新（检查本地日志） ====================
async function updateBadge() {
    try {
        const logs = await getAllLogs();
        const hasLocalChanges = logs.length > 0;
        const syncBadge = document.getElementById('sync-badge');
        const logBadge = document.getElementById('log-badge');

        // 日志角标：显示条数
        if (logBadge) {
            if (hasLocalChanges) {
                logBadge.style.display = 'inline-flex';
                logBadge.textContent = logs.length;
            } else {
                logBadge.style.display = 'none';
            }
        }

                // 同步角标：根据状态显示
        if (syncBadge) {
            syncBadge.className = ''; // 清除旧类
            if (hasLocalChanges) {
                // 有本地修改 → 红色!
                syncBadge.textContent = '!';
                syncBadge.classList.add('warn');
                syncBadge.style.display = 'inline-flex';
            } else if (serverNewVersion) {
                // 无本地修改，但服务器有新版本 → 绿色NEW
                syncBadge.textContent = 'NEW';
                syncBadge.classList.add('info');
                syncBadge.style.display = 'inline-flex';
            } else {
                syncBadge.style.display = 'none';
            }
        }
        const menuBadge = document.getElementById('menu-badge-dot');
        if (menuBadge) {
            menuBadge.style.display = hasLocalChanges ? 'inline' : 'none';
        }
    
    } catch (e) {
        const syncBadge = document.getElementById('sync-badge');
        const logBadge = document.getElementById('log-badge');
        if (syncBadge) syncBadge.style.display = 'none';
        if (logBadge) logBadge.style.display = 'none';
    }
}

// ==================== 从 IndexedDB 加载缓存数据 ====================
async function loadFromCache() {
  try {
    await openDB();
    const brands = await getAll('brands');
    const specs = await getAll('specs');
    const materials = await getAll('materials');
    const version = await getMeta('local_version');
    if (brands.length > 0) {
      brandsData = brands;
      specsData = specs;
      materialsData = materials;
      localVersion = parseInt(version) || 0;
      // 恢复上次选中的线号
        const savedLine = await getMeta('current_line');
        if (savedLine && ['V', 'C', 'R'].includes(savedLine)) {
            currentLine = savedLine;
        }  
      renderBrands();
      renderSpecs();
      updateBadge();
    if (typeof loadPromoUsageMap === 'function') loadPromoUsageMap();  // ✅ 加载点击率
      console.log('从缓存加载成功，版本:', localVersion);
    } else {
      console.log('缓存为空，等待首次同步');
    }
  } catch (e) {
    console.error('缓存加载失败:', e);
  }
}

// ==================== DOM 元素 ====================
const titleEl = document.getElementById('title');
const brandGrid = document.getElementById('brand-grid');
const specGrid = document.getElementById('spec-grid');
const lineBtns = document.querySelectorAll('.line-btn');
const menuBtn = document.getElementById('menu-btn');


// ==================== 数据同步（带版本检查） ====================
async function loadData(forceUpdate = false) {
  try {
    const verResp = await fetch('https://cloudgj.cn/data/version.txt');
    if (!verResp.ok) throw new Error('版本检查失败');
    const remoteVersion = parseInt((await verResp.text()).trim());
    
    if (remoteVersion <= localVersion && brandsData.length > 0) {
      console.log('已经是最新版本:', localVersion);
      serverNewVersion = false;
      await putMeta('server_new_version', 'false');
      return;
    }
    
    console.log(`发现新版本: ${remoteVersion} (本地: ${localVersion})`);
    serverNewVersion = true;
    await putMeta('server_new_version', 'true');
    
    // 如果不是强制更新 且 本地已有缓存 → 不下载，只更新红点
    if (!forceUpdate && brandsData.length > 0) {
      updateBadge();
      return;
    }
    
    // ========== 以下为强制更新/首次下载流程 ==========
    const dataResp = await fetch('https://cloudgj.cn/data/hcquick_data.json');
    if (!dataResp.ok) throw new Error('数据下载失败');
    const json = await dataResp.json();
    
    await openDB();
    // 1. 备份本地所有备注
    const oldSpecs = await getAll('specs');
    const oldMaterials = await getAll('materials');
    const specRemarks = {};
oldSpecs.forEach(s => { if (s.remark) specRemarks[`${s.brand_id}_${s.name}`] = s.remark; });
    const materialRemarks = {};
oldMaterials.forEach(m => {
    if (m.remark) {
        const key = `${m.material_type}_${m.spec_id}_${m.custom_name}`;
        materialRemarks[key] = m.remark;
    }
});

    // 2. 全量覆盖
    await clearAndPutAll('brands', json.brands || []);
    await clearAndPutAll('specs', json.specs || []);
    await clearAndPutAll('materials', json.material_config || []);

    // 3. 恢复本地备注
    await restoreRemarks(specRemarks, materialRemarks, json.material_config || []);

    // 4. 更新版本号
    await putMeta('local_version', String(json.version || remoteVersion));
    
    brandsData = json.brands || [];
    specsData = json.specs || [];
    materialsData = json.material_config || [];
    localVersion = json.version || remoteVersion;
    
    renderBrands();
    renderSpecs();
    titleEl.textContent = 'HCQuick';
    selectedBrandId = null;
    selectedSpecId = null;
    
    console.log('同步完成，版本:', localVersion);
    updateBadge();
  } catch (e) {
    console.error('同步失败:', e);
    if (brandsData.length === 0) {
      brandGrid.innerHTML = '<span class="hint">数据加载失败，请检查网络</span>';
    }
  }
}
// ==================== 品牌渲染 ====================
function renderBrands() {
    const filtered = brandsData.filter(b => b.line_code === currentLine);
    if (filtered.length === 0) {
        brandGrid.innerHTML = '<span class="hint">暂无品牌</span>';
        return;
    }
    brandGrid.innerHTML = filtered.map(b => `
        <button class="grid-btn ${b.id === selectedBrandId ? 'selected' : ''}"
                data-brand-id="${b.id}">
            ${b.name}
        </button>
    `).join('');
    
    brandGrid.querySelectorAll('.grid-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedBrandId = parseInt(btn.dataset.brandId);
            renderBrands();
            renderSpecs();
            const brand = brandsData.find(b => b.id === selectedBrandId);
            if (brand) {
                titleEl.textContent = `${currentLine}线 - ${brand.name}`;
            }
        });
        
        bindLongPress(btn, () => {
            const brand = brandsData.find(b => b.id === parseInt(btn.dataset.brandId));
            showBrandContextMenu(brand, btn);
        });
    });
}

// ==================== 规格渲染 ====================
function renderSpecs() {
    if (!selectedBrandId) {
        specGrid.innerHTML = '<span class="hint">请先选择一个品牌</span>';
        return;
    }
    const filtered = specsData.filter(s => s.brand_id === selectedBrandId);
    if (filtered.length === 0) {
        specGrid.innerHTML = '<span class="hint">暂无规格</span>';
        return;
    }
    specGrid.innerHTML = filtered.map(s => `
        <button class="grid-btn ${s.id === selectedSpecId ? 'selected' : ''}"
                data-spec-id="${s.id}">
            ${s.name}
        </button>
    `).join('');
    
    // 只保留长按事件（仅此一处，无需重复）
    specGrid.querySelectorAll('.grid-btn').forEach(btn => {
        bindLongPress(btn, () => {
            const spec = specsData.find(s => s.id === parseInt(btn.dataset.specId));
            showSpecContextMenu(spec, btn);
        });
    });
}
// ==================== 线号切换 ====================
lineBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        lineBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        currentLine = btn.dataset.line;
        selectedBrandId = null;
        selectedSpecId = null;
        titleEl.textContent = 'HCQuick';
        renderBrands();
        renderSpecs();
        await putMeta('current_line', currentLine);
    });
});
let serverNewVersion = false;  // 服务器是否有新版本
// ==================== 菜单功能 ====================
let menuVisible = false;
let isInCalcPage = false;

function renderMenu() {
    const menu = document.getElementById('dropdown-menu');
    const syncHTML = `
    <div class="menu-item" onclick="handleSync()">
        🔄 同步
        <span id="sync-badge" style="display:none;"></span>
    </div>`;
const logHTML = `
    <div class="menu-item" onclick="showLogDialog()">
        📋 日志
        <span id="log-badge" style="display:none;"></span>
    </div>`;
    const settingsHTML = `<div class="menu-item" onclick="showSettingsDialog()">⚙️ 设置</div>`;
    if (isInCalcPage) {
        menu.innerHTML = `
            <div class="menu-item" onclick="addBottleMaterial()">+ 增加瓶子类</div>
            <div class="menu-item" onclick="addPumpCapMaterial()">+ 增加泵盖类</div>
            <div class="menu-item" onclick="addLabelMaterial()">+ 增加标签类</div>
            <div class="menu-item" onclick="addPromoTagMaterial()">+ 增加促销标签类</div>
        `;
    } else {
        menu.innerHTML = `
            <div class="menu-item" onclick="showAddBrandDialog()">+ 增加品牌</div>
            <div class="menu-item" onclick="showAddSpecDialog()">+ 增加规格</div>
            <div class="divider"></div>
            ${syncHTML}
            <div class="divider"></div>
            ${logHTML}
            ${settingsHTML}
        `;
    }
}

menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menuVisible) {
        renderMenu();
        updateBadge();
        const menu = document.getElementById('dropdown-menu');
        const btnRect = e.target.getBoundingClientRect();
        menu.style.top = (btnRect.bottom + 8) + 'px';  // 往下移 8px
        menu.style.right = (window.innerWidth - btnRect.right - 10) + 'px'; 
        menu.style.left = 'auto';
        menu.style.display = 'block';
        menuVisible = true;
    } else {
        document.getElementById('dropdown-menu').style.display = 'none';
        menuVisible = false;
    }
});

document.addEventListener('click', () => {
    menuVisible = false;
    document.getElementById('dropdown-menu').style.display = 'none';
});

// ==================== 同步处理 ====================
async function handleSync() {
    menuVisible = false;
    document.getElementById('dropdown-menu').style.display = 'none';
    
    // 1. 检查是否有本地修改日志
    const logs = await getAllLogs();
    if (logs.length > 0) {
        checkAndSync(); // 有日志则弹窗确认
        return;
    }
    
    // 2. 无本地修改，直接进行数据更新
        const oldVersion = localVersion;
    await loadData(true);
    if (localVersion > oldVersion) {
        serverNewVersion = false;
        await putMeta('server_new_version', 'false');
        location.reload();
    } else {
        // 需确认：新版可能在启动时已检测到
        if (serverNewVersion) {
            if (confirm('发现新版本数据库，是否下载？')) {
                await loadData(true);
                serverNewVersion = false;
                await putMeta('server_new_version', 'false');
                location.reload();
            }
        } else {
            alert('数据已是最新版本');
        }
    }
}
async function checkAndSync() {
    try {
        const logs = await getAllLogs();
        if (logs.length > 0) {
            showSyncConfirmDialog(logs);
        } else {
            // 正常情况下不会走到这里（handleSync已判断），但保留兜底
            await loadData(true);
            location.reload();
        }
    } catch (e) {
        console.error('检查日志失败:', e);
        await loadData(true);
        location.reload();
    }
}

// ==================== 长按工具 ====================
function bindLongPress(element, callback) {
    let timer;
    element.addEventListener('touchstart', () => {
        timer = setTimeout(() => {
            callback();
            clearTimeout(timer);
        }, 500);
    });
    element.addEventListener('touchend', () => clearTimeout(timer));
    element.addEventListener('touchmove', () => clearTimeout(timer));
}

// ==================== 品牌上下文菜单 ====================
function showBrandContextMenu(brand, element) {
    document.querySelector('.context-menu')?.remove();
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <div class="context-item" onclick="editBrand(${brand.id})">编辑</div>
        <div class="divider"></div>
        <div class="context-item" style="color:#E53935;" onclick="deleteBrand(${brand.id})">删除</div>
    `;
    document.body.appendChild(menu);
    
    const rect = element.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.display = 'block';
    
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 100);
}

// ==================== 品牌编辑/删除 ====================
async function editBrand(id) {
    const brand = brandsData.find(b => b.id === id);

    showFormEditor('编辑品牌', [
        { label: '品牌名称', key: 'name', value: brand.name, type: 'text', required: true }
    ], async (values) => {
        await openDB();
        const updated = { ...brand, name: values.name, updated_at: Math.floor(Date.now() / 1000) };

        const tx = db.transaction('brands', 'readwrite');
        const store = tx.objectStore('brands');
        await new Promise((resolve, reject) => {
            const req = store.put(updated);
            req.onsuccess = resolve;
            req.onerror = reject;
        });

        const logData = {
            type: 'UPDATE',
            table: 'brands',
            path: `${brand.line_code} 线 > ${brand.name}`,
            changes: { '名称': { old: brand.name, new: updated.name } }
        };
        await addLog({
            operation_type: 'UPDATE',
            table_name: 'brands',
            data_json: JSON.stringify(logData),
            created_at: Math.floor(Date.now() / 1000)
        });

        brandsData = await getAll('brands');
        renderBrands();
        if (selectedBrandId === id) renderSpecs();
        updateBadge();
    });
}

async function deleteBrand(id) {
    if (!confirm('确定删除该品牌吗？')) return;
    const brand = brandsData.find(b => b.id === id);
    await openDB();
    const tx = db.transaction('brands', 'readwrite');
    const store = tx.objectStore('brands');
    await new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = resolve;
        request.onerror = reject;
    });
    
    const logData = {
        type: 'DELETE',
        table: 'brands',
        path: `${brand.line_code} 线 > ${brand.name}`,
        deleted_data: brand
    };
    await addLog({
        operation_type: 'DELETE',
        table_name: 'brands',
        data_json: JSON.stringify(logData),
        created_at: Math.floor(Date.now() / 1000)
    });
    
    brandsData = await getAll('brands');
    if (selectedBrandId === id) selectedBrandId = null;
    renderBrands();
    renderSpecs();
    updateBadge();
    document.querySelector('.context-menu')?.remove();
}

async function showAddBrandDialog() {
    menuVisible = false;
    document.getElementById('dropdown-menu').style.display = 'none';

    showFormEditor('新增品牌', [
        { label: '品牌名称', key: 'name', value: '', type: 'text', required: true }
    ], async (values) => {
        await openDB();
        const all = await getAll('brands');
        const maxId = all.reduce((max, b) => Math.max(max, b.id || 0), 0);
        const newBrand = {
            id: maxId + 1,
            line_code: currentLine,
            name: values.name,
            sort_order: 0,
            created_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000)
        };

        const tx = db.transaction('brands', 'readwrite');
        const store = tx.objectStore('brands');
        await new Promise((resolve, reject) => {
            const req = store.add(newBrand);
            req.onsuccess = resolve;
            req.onerror = reject;
        });

        await addLog({
            operation_type: 'INSERT',
            table_name: 'brands',
            data_json: JSON.stringify({
                type: 'INSERT',
                table: 'brands',
                path: `${currentLine} 线 > ${newBrand.name}`,
                data: newBrand
            }),
            created_at: Math.floor(Date.now() / 1000)
        });

        brandsData = await getAll('brands');
        renderBrands();
        updateBadge();
    });
}
// ==================== 设置对话框 ====================
async function showSettingsDialog() {
    menuVisible = false;
    document.getElementById('dropdown-menu').style.display = 'none';
    document.getElementById('settings-data-version').textContent = localVersion || '-';
    document.getElementById('settings-apk-version').textContent = '1.0.3';

    // 默认选中“云盘版”
    const currentMode = await getMeta('sync_mode') || 'netdisk';
    const radio = document.querySelector(`input[name="syncMode"][value="${currentMode}"]`);
    if (radio) radio.checked = true;

    // 预填默认服务器地址
    const DEFAULT_BASE = 'https://cloudgj.cn/data/';
    const DEFAULT_DATA_FILE = 'hcquick_data.json';
    const DEFAULT_VERSION_FILE = 'version.txt';
    const baseUrl = await getMeta('custom_base_url') || DEFAULT_BASE;
    const dataFile = await getMeta('custom_data_file') || DEFAULT_DATA_FILE;
    const versionFile = await getMeta('custom_version_file') || DEFAULT_VERSION_FILE;
    
    document.getElementById('settings-base-url').value = baseUrl;
    document.getElementById('settings-data-file').value = dataFile;
    document.getElementById('settings-version-file').value = versionFile;
    updateUrlPreview();

    document.getElementById('settings-overlay').style.display = 'flex';
}

// 切换同步模式
async function setSyncMode(mode) {
    await putMeta('sync_mode', mode);
}

// 更新 URL 预览
function updateUrlPreview() {
    const base = document.getElementById('settings-base-url').value || '';
    const dataFile = document.getElementById('settings-data-file').value || '';
    document.getElementById('settings-url-preview').textContent = base + dataFile;
}

// 输入框自动保存
document.getElementById('settings-base-url').addEventListener('change', async function() {
    await putMeta('custom_base_url', this.value);
    updateUrlPreview();
});
document.getElementById('settings-data-file').addEventListener('change', async function() {
    await putMeta('custom_data_file', this.value);
    updateUrlPreview();
});
document.getElementById('settings-version-file').addEventListener('change', async function() {
    await putMeta('custom_version_file', this.value);
    updateUrlPreview();
});

function closeSettingsDialog() {
    document.getElementById('settings-overlay').style.display = 'none';
}

function saveAndRestart() {
    location.reload();
}

// ==================== 日志对话框 ====================
async function showLogDialog() {
    menuVisible = false;
    document.getElementById('dropdown-menu').style.display = 'none';
    
    const logs = await getAllLogs();
    const listEl = document.getElementById('log-viewer-list');
    
    if (logs.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#888;">暂无本地修改记录</div>';
    } else {
        listEl.innerHTML = logs.slice().reverse().map(log => {
            let data;
            try {
                data = JSON.parse(log.data_json);
            } catch {
                data = { type: '未知', path: '解析失败' };
            }
            const typeMap = { INSERT: '新增', UPDATE: '修改', DELETE: '删除' };
            const typeName = typeMap[data.type] || data.type || '未知';
            const time = new Date(log.created_at * 1000).toLocaleString('zh-CN');
            
            let changesHTML = '';
            if (data.changes) {
                changesHTML = Object.entries(data.changes).map(([key, val]) => {
                    return `${key}: ${val.old} → ${val.new}`;
                }).join('<br>');
            }
            
            return `
                <div class="log-entry">
                    <div class="log-type ${data.type}">操作：${typeName}</div>
                    <div class="log-path">路径：${data.path || '未知'}</div>
                    ${changesHTML ? `<div class="log-changes">变更：<br>${changesHTML}</div>` : ''}
                    <div class="log-time">时间：${time}</div>
                </div>
            `;
        }).join('');
    }
    
    document.getElementById('log-viewer-overlay').style.display = 'flex';
}

// ==================== 导入导出 ====================
function importJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        const text = await file.text();
        const json = JSON.parse(text);
        await openDB();
        await clearAndPutAll('brands', json.brands || []);
        await clearAndPutAll('specs', json.specs || []);
        await clearAndPutAll('materials', json.material_config || []);
        await putMeta('local_version', String(json.version || 0));
        location.reload();
    };
    input.click();
}

function exportJson() {
    const json = {
        version: localVersion,
        brands: brandsData,
        specs: specsData,
        material_config: materialsData
    };
    const blob = new Blob([JSON.stringify(json, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hcquick_backup.json';
    a.click();
    URL.revokeObjectURL(url);
}

// ==================== 规格上下文菜单 ====================
function showSpecContextMenu(spec, element) {
    document.querySelector('.context-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <div class="context-item" onclick="editSpec(${spec.id})">编辑</div>
        <div class="divider"></div>
        <div class="context-item" style="color:#E53935;" onclick="deleteSpec(${spec.id})">删除</div>
    `;
    document.body.appendChild(menu);
    const rect = element.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.display = 'block';
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 100);
}
// ==================== 通用表单编辑器 ====================
function showFormEditor(title, fields, onSave) {
    // 移除可能残留的弹窗
    document.getElementById('form-editor-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'form-editor-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:1002;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#FFFFFF;border-radius:12px;width:80%;max-width:360px;padding:16px;display:flex;flex-direction:column;';
    dialog.innerHTML = `
        <div style="font-size:16px;font-weight:500;text-align:center;margin-bottom:14px;color:#333;">${title}</div>
        ${fields.map(f => `
            <div class="me-row">
                <div class="me-input-wrap">
                    <label class="me-label-float">${f.label}${f.key === 'remark' ? '（选填）' : ''}</label>
                    <input type="text" class="me-input" id="fe-${f.key}" value="${f.value || ''}" ${f.type === 'number' ? 'inputmode="numeric"' : ''}>
                </div>
            </div>
        `).join('')}
        <div style="display:flex;gap:8px;margin-top:14px;">
            <button class="dialog-btn-cancel" id="fe-btn-cancel" style="flex:1;height:44px;font-size:15px;border-radius:8px;">取消</button>
            <button class="dialog-btn-danger" id="fe-btn-save" style="flex:1;height:44px;font-size:15px;border-radius:8px;">保存</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 关闭事件
    const close = () => overlay.remove();
    document.getElementById('fe-btn-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // 保存事件
    document.getElementById('fe-btn-save').addEventListener('click', () => {
        const values = {};
        for (const f of fields) {
            const input = document.getElementById(`fe-${f.key}`);
            const val = input.value.trim();
            if (f.required && !val) {
                alert(`${f.label}不能为空`);
                return;
            }
            if (f.key === 'sort') {
                const num = parseInt(val);
                if (isNaN(num) || num < 1 || num > 9999) {
                    alert('规格数字需为1-4位正整数');
                    return;
                }
                values[f.key] = num;
            } else if (f.key === 'name') {
                if (!val || val.length > 15) {
                    alert('品牌名称需为1-15字符');
                    return;
                }
                values[f.key] = val;
            } else {
                values[f.key] = val;
            }
        }
        close();
        onSave(values);
    });
}
async function editSpec(id) {
    const spec = specsData.find(s => s.id === id);
    const brandName = brandsData.find(b => b.id === spec.brand_id)?.name || '';

    showFormEditor('编辑规格', [
        { label: '规格数字', key: 'sort', value: spec.sort_number, type: 'number', required: true },
        { label: '备注', key: 'remark', value: spec.remark || '', type: 'text', required: false }
    ], async (values) => {
        await openDB();
        const updated = {
            ...spec,
            sort_number: values.sort,
            name: `${brandName} ${values.sort}`,
            remark: values.remark,
            updated_at: Math.floor(Date.now() / 1000)
        };

        const tx = db.transaction('specs', 'readwrite');
        const store = tx.objectStore('specs');
        await new Promise((resolve, reject) => {
            const req = store.put(updated);
            req.onsuccess = resolve;
            req.onerror = reject;
        });

        const logData = {
            type: 'UPDATE',
            table: 'specs',
            path: `${currentLine} 线 > ${brandName} > ${spec.name}`,
            changes: { '排序': { old: spec.sort_number, new: values.sort } }
        };
        await addLog({
            operation_type: 'UPDATE',
            table_name: 'specs',
            data_json: JSON.stringify(logData),
            created_at: Math.floor(Date.now() / 1000)
        });

        specsData = await getAll('specs');
        renderSpecs();
        updateBadge();
    });
}
async function deleteSpec(id) {
    if (!confirm('确定删除该规格吗？')) return;
    const spec = specsData.find(s => s.id === id);
    await openDB();
    const tx = db.transaction('specs', 'readwrite');
    const store = tx.objectStore('specs');
    await new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = resolve;
        request.onerror = reject;
    });
    const logData = {
        type: 'DELETE',
        table: 'specs',
        path: `${currentLine} 线 > ${brandsData.find(b => b.id === spec.brand_id)?.name} > ${spec.name}`,
        deleted_data: spec
    };
    await addLog({
        operation_type: 'DELETE',
        table_name: 'specs',
        data_json: JSON.stringify(logData),
        created_at: Math.floor(Date.now() / 1000)
    });
    specsData = await getAll('specs');
    renderSpecs();
    updateBadge();
    document.querySelector('.context-menu')?.remove();
}

async function showAddSpecDialog() {
    menuVisible = false;
    document.getElementById('dropdown-menu').style.display = 'none';
    if (!selectedBrandId) {
        alert('请先选择一个品牌');
        return;
    }

    showFormEditor('新增规格', [
        { label: '规格数字', key: 'sort', value: '', type: 'number', required: true },
        { label: '备注', key: 'remark', value: '', type: 'text', required: false }
    ], async (values) => {
        await openDB();
        const all = await getAll('specs');
        const maxId = all.reduce((max, s) => Math.max(max, s.id || 0), 0);
        const brand = brandsData.find(b => b.id === selectedBrandId);
        const newSpec = {
            id: maxId + 1,
            brand_id: selectedBrandId,
            name: `${brand.name} ${values.sort}`,
            sort_number: values.sort,
            remark: values.remark,
            created_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000)
        };

        const tx = db.transaction('specs', 'readwrite');
        const store = tx.objectStore('specs');
        await new Promise((resolve, reject) => {
            const req = store.add(newSpec);
            req.onsuccess = resolve;
            req.onerror = reject;
        });

        await addLog({
            operation_type: 'INSERT',
            table_name: 'specs',
            data_json: JSON.stringify({
                type: 'INSERT',
                table: 'specs',
                path: `${currentLine} 线 > ${brand.name} > ${newSpec.name}`,
                data: newSpec
            }),
            created_at: Math.floor(Date.now() / 1000)
        });

        specsData = await getAll('specs');
        renderSpecs();
        updateBadge();
    });
}

// ==================== 同步确认弹窗 ====================
function showSyncConfirmDialog(logs) {
    const overlay = document.getElementById('sync-confirm-overlay');
    const list = document.getElementById('sync-confirm-list');
    
    list.innerHTML = logs.slice(0, 10).map(log => {
        try {
            const data = JSON.parse(log.data_json);
            return `<div>• ${data.type}: ${data.path}</div>`;
        } catch {
            return `<div>• 未知操作</div>`;
        }
    }).join('');
    
    if (logs.length > 10) {
        list.innerHTML += `<div style="color:#888;margin-top:4px;">... 共 ${logs.length} 条修改记录</div>`;
    }
    
    overlay.style.display = 'flex';
}

document.getElementById('sync-confirm-ok').addEventListener('click', async () => {
    document.getElementById('sync-confirm-overlay').style.display = 'none';
    await forceSyncAndReload(); // 关键修改
});
document.getElementById('sync-confirm-cancel').addEventListener('click', () => {
    document.getElementById('sync-confirm-overlay').style.display = 'none';
});


async function forceSyncAndReload() {
    try {
        // 直接下载完整 JSON，跳过版本检查
        const dataResp = await fetch('https://cloudgj.cn/data/hcquick_data.json');
        if (!dataResp.ok) throw new Error('数据下载失败');
        const json = await dataResp.json();
        
        await openDB();
        // 1. 备份本地所有备注
        const oldSpecs = await getAll('specs');
        const oldMaterials = await getAll('materials');
        const specRemarks = {};
        oldSpecs.forEach(s => { if (s.remark) specRemarks[s.id] = s.remark; });
        const materialRemarks = {};
        oldMaterials.forEach(m => { if (m.remark) materialRemarks[m.id] = { remark: m.remark, type: m.material_type }; });

        // 2. 全量覆盖 IndexedDB
        await clearAndPutAll('brands', json.brands || []);
        await clearAndPutAll('specs', json.specs || []);
        await clearAndPutAll('materials', json.material_config || []);

        // 3. 恢复本地备注
        await restoreRemarks(specRemarks, materialRemarks, json.material_config || []);

        
                       // 4. 更新版本号
        const verResp = await fetch('https://cloudgj.cn/data/version.txt');
        if (verResp.ok) {
            const remoteVersion = parseInt((await verResp.text()).trim());
            await putMeta('local_version', String(json.version || remoteVersion));
        } else if (json.version) {
            await putMeta('local_version', String(json.version));
        }
        
        // ✅ 清除所有本地修改日志
        await clearAllLogs();
        
        // 重启页面，加载最新数据
        location.reload();
    } catch (e) {
        console.error('强制同步失败:', e);
        alert('强制同步失败，请检查网络后重试');
    }
}
// 日志弹窗关闭
document.getElementById('log-viewer-close').addEventListener('click', () => {
    document.getElementById('log-viewer-overlay').style.display = 'none';
});
// ==================== 启动 ====================
(async () => {
    currentLine = 'C';
    await openDB();
    const brands = await getAll('brands');
    if (brands.length > 0) {
        // 已有缓存数据
        brandsData = brands;
        specsData = await getAll('specs');
        materialsData = await getAll('materials');
        const version = await getMeta('local_version');
        localVersion = parseInt(version) || 0;
        const serverNew = await getMeta('server_new_version');
        serverNewVersion = serverNew === 'true';
        renderBrands();
        renderSpecs();
        updateBadge();
        if (localVersion > 0) {
            loadData().catch(() => {});
        }
    } else {
        // 首次访问：自动拉取最新数据
        await loadData();
        updateBadge();
        if (typeof loadPromoUsageMap === 'function') loadPromoUsageMap();  // ✅ 加载点击率
    }
})();
// ==================== 备注恢复 ====================
async function restoreRemarks(specRemarks, materialRemarks, newMaterials) {
    // 1. 恢复规格备注：按 brand_id + name 匹配
    const allSpecs = await getAll('specs'); // 新数据已在 DB 中
    for (const spec of allSpecs) {
        const key = `${spec.brand_id}_${spec.name}`;
        const localRemark = specRemarks[key];
        if (localRemark) {
            const tx = db.transaction('specs', 'readwrite');
            const store = tx.objectStore('specs');
            const specRecord = await new Promise(resolve => {
                const req = store.get(spec.id);
                req.onsuccess = () => resolve(req.result);
            });
            if (specRecord) {
                specRecord.remark = localRemark;
                store.put(specRecord);
            }
            await new Promise(r => { tx.oncomplete = r; });
        }
    }

    // 2. 恢复材料备注
    const allMaterials = await getAll('materials');
    for (const mat of allMaterials) {
        const key = `${mat.material_type}_${mat.spec_id}_${mat.custom_name}`;
        const localRemark = materialRemarks[key];
        if (!localRemark) continue;

        if (mat.material_type === 'BOTTLE' || mat.material_type === 'PUMP_CAP') {
            // 非标签类：始终恢复本地备注
            mat.remark = localRemark;
            const tx = db.transaction('materials', 'readwrite');
            const store = tx.objectStore('materials');
            store.put(mat);
            await new Promise(r => { tx.oncomplete = r; });
        } else if (mat.material_type === 'LABEL' || mat.material_type === 'PROMO_TAG') {
            // 检查官方是否有非空备注
            if (!mat.remark || mat.remark.trim() === '') {
                // 官方无备注，恢复本地备注
                mat.remark = localRemark;
                const tx = db.transaction('materials', 'readwrite');
                const store = tx.objectStore('materials');
                store.put(mat);
                await new Promise(r => { tx.oncomplete = r; });
            }
            // 官方有备注则保留官方，不恢复本地
        }
    }
}
