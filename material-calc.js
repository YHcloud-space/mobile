// ==================== 材料计算 DOM 元素 ====================
const backBtn = document.getElementById('back-btn');
const calcPage = document.getElementById('calc-page');
const brandSpecPage = document.getElementById('brand-spec-page');
const inputX = document.getElementById('input-x');
const resultBox = document.getElementById('result-box');
const materialGrid = document.getElementById('material-grid');
const promoCard = document.getElementById('promo-card');
const subOptions = document.getElementById('sub-options');
const propertyCard = document.getElementById('property-card');

let selectedMaterial = null;
let isFirstMaterialClick = true;
let selectedPromoTag = null;
let rollCount = 1;
let peelMode = 'NONE';
let bottleAccum = { expression: '', totalEA: 0 };


// ==================== 进入 / 退出计算页面 ====================
function enterCalcPage() {
    isInCalcPage = true;
    isFirstMaterialClick = true;
    const spec = specsData.find(s => s.id === selectedSpecId);
    const brand = brandsData.find(b => b.id === spec?.brand_id);
    titleEl.textContent = `${currentLine}线 - ${spec?.name || ''}`;
    backBtn.style.display = 'inline';
    document.getElementById('nav-icon').style.display = 'none';
    
    document.getElementById('brand-spec-page').style.display = 'none';
    calcPage.style.display = 'block';
    
    renderMaterials();
    if (spec?.remark) {
    propertyCard.innerHTML = `<div style="margin-bottom:8px;font-size:14px;font-weight:bold;">规格: ${spec.remark}</div>`;
    } else {
        updateCalcUI();
    }
    inputX.focus();
}


function backToBrandSpec() {
    isInCalcPage = false;
    isFirstMaterialClick = true;
    calcPage.style.display = 'none';
    document.getElementById('brand-spec-page').style.display = 'block';
    
    backBtn.style.display = 'none';
    document.getElementById('nav-icon').style.display = 'inline';
    selectedSpecId = null;
    selectedMaterial = null;
    selectedPromoTag = null;
    inputX.value = '';
    resultBox.textContent = '0.0';
    promoCard.textContent = '促销标签: 请选择代码';
    promoCard.classList.remove('active');
    bottleAccum = { expression: '', totalEA: 0 };
    
    titleEl.textContent = selectedBrandId 
        ? `${currentLine}线-${brandsData.find(b => b.id === selectedBrandId)?.name || ''}`
        : 'HCQuick';
    renderSpecs();
    (async () => {
        try {
            const logs = await getAllLogs();
            if (logs.length > 0) {
                setTimeout(() => {
                    alert('您有未同步的本地修改，请确认修改正确后联系管理员更新主数据。');
                }, 300);
            }
        } catch (e) {}
    })();
}


// ==================== 材料渲染 ====================
function renderMaterials() {
    const filtered = materialsData.filter(m => 
        m.spec_id === selectedSpecId && m.material_type !== 'PROMO_TAG'
    );
    materialGrid.innerHTML = filtered.map(m => `
        <button class="grid-btn ${selectedMaterial?.id === m.id ? 'selected' : ''}"
                data-mat-id="${m.id}">
            ${m.custom_name}
        </button>
    `).join('');
    
    materialGrid.querySelectorAll('.grid-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedMaterial = materialsData.find(m => m.id === parseInt(btn.dataset.matId));
            selectedPromoTag = null;
            if (!isFirstMaterialClick) {
                inputX.value = '';
                resultBox.textContent = '0.0';
            }
            isFirstMaterialClick = false;
            updateCalcUI();
            inputX.focus();
        });
        
        // 长按事件
        bindLongPress(btn, () => {
            const mat = materialsData.find(m => m.id === parseInt(btn.dataset.matId));
            showMaterialContextMenu(mat, btn);
        });
    });
}

// ==================== 材料上下文菜单 ====================
function showMaterialContextMenu(mat, element) {
    document.querySelector('.context-menu')?.remove();
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <div class="context-item" onclick="editMaterial(${mat.id})">编辑</div>
        <div class="divider"></div>
        <div class="context-item" style="color:#E53935;" onclick="deleteMaterial(${mat.id})">删除</div>
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

// ==================== 材料编辑 ====================
async function editMaterial(id) {
    const mat = materialsData.find(m => m.id === id);
    if (!mat) return;
    openMaterialEditor(mat.material_type, mat);
}
// ==================== 材料删除 ====================
async function deleteMaterial(id) {
    if (!confirm('确定删除该材料吗？')) return;
    const mat = materialsData.find(m => m.id === id);
    if (!mat) return;
    
    const spec = specsData.find(s => s.id === mat.spec_id);
    const brand = brandsData.find(b => b.id === spec?.brand_id);
    
    await openDB();
    const tx = db.transaction('materials', 'readwrite');
    const store = tx.objectStore('materials');
    await new Promise((resolve, reject) => { const req = store.delete(id); req.onsuccess = resolve; req.onerror = reject; });
    
    const logData = { type: 'DELETE', table: 'materials',
        path: `${currentLine} 线 > ${brand?.name || ''} > ${spec?.name || ''} > ${mat.custom_name}`,
        deleted_data: {}
    };
    if (mat.material_type === 'BOTTLE') logData.deleted_data = { p1: mat.p1 };
    else if (mat.material_type === 'PUMP_CAP') logData.deleted_data = { p1: mat.p1, t1: mat.t1, t2: mat.t2 };
    else logData.deleted_data = { m: mat.m, c: mat.c, q: mat.q, ...(mat.m_code ? { m_code: mat.m_code } : {}) };
    
    await addLog({ operation_type: 'DELETE', table_name: 'materials',
        data_json: JSON.stringify(logData), created_at: Math.floor(Date.now()/1000) });
    
    materialsData = await getAll('materials');
    renderMaterials();
    updateCalcUI();
    updateBadge();
    document.querySelector('.context-menu')?.remove();
}

// ==================== 计算更新 ====================
function updateCalcUI() {
    const active = selectedMaterial || selectedPromoTag;
    if (!active) {
        subOptions.innerHTML = '';
        propertyCard.innerHTML = '';
        return;
    }
    renderMaterials();
    
    if (active.material_type === 'PUMP_CAP') {
        subOptions.innerHTML = `
            <button class="sub-btn ${peelMode === 'NONE' ? 'selected' : ''}" data-peel="NONE">无</button>
            <button class="sub-btn ${peelMode === 'CARTON' ? 'selected' : ''}" data-peel="CARTON">纸箱去皮</button>
            <button class="sub-btn ${peelMode === 'PLASTIC' ? 'selected' : ''}" data-peel="PLASTIC">胶箱去皮</button>
        `;
    } else if (['LABEL', 'PROMO_TAG'].includes(active.material_type)) {
        subOptions.innerHTML = `
           <button class="sub-btn ${rollCount === 1 ? 'selected' : ''}" data-roll="1">1 卷</button>
           <button class="sub-btn ${rollCount === 2 ? 'selected' : ''}" data-roll="2">2 卷</button>
           <button class="sub-btn ${rollCount === 3 ? 'selected' : ''}" data-roll="3">3 卷</button>
        `;
    } else {
        subOptions.innerHTML = '';
    }
    
    if (active && active.material_type === 'BOTTLE') {
        subOptions.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;width:100%;background:#F5F5F5;padding:8px;border-radius:8px;">
                <span style="font-size:12px;color:#888;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${bottleAccum.expression || '—'}</span>
                <button class="sub-btn" data-action="bottleTotal">Total</button>
                <span style="background:#FFF0F5;padding:8px 12px;border-radius:8px;font-weight:bold;color:#1565C0;font-size:14px;">${bottleAccum.totalEA.toFixed(1)}</span>
            </div>
        `;
    }
    
    propertyCard.innerHTML = buildPropertyText(active);
    promoCard.classList.toggle('active', !!selectedPromoTag);
    calcResult();
}

function setPeel(mode) { peelMode = mode; updateCalcUI(); inputX.focus(); }
function setRoll(n) { rollCount = n; updateCalcUI(); inputX.focus(); }

function buildPropertyText(m) {
    let text;
    switch (m.material_type) {
        case 'BOTTLE': text = `p1: ${m.p1} g`; break;
        case 'PUMP_CAP': text = `p1: ${m.p1} g | t1: ${m.t1} kg | t2: ${m.t2} kg`; break;
        case 'LABEL': case 'PROMO_TAG':
            const n = m.q / (m.m - m.c);
            text = `m: ${m.m} kg | c: ${m.c} kg | q: ${m.q} EA`;
            if (m.m > m.c && m.q > 0) text += ` | n: ${n.toFixed(1)} EA/kg`;
            break;
        default: text = '';
    }
        if (m.remark) {
        text += `<br><strong style="font-size:14px;">备注: ${m.remark}</strong>`;
    }
    
    return text;
}

// ==================== 计算逻辑 ====================
inputX.addEventListener('input', calcResult);

function calcResult() {
    let rawValue = inputX.value;
    let filtered = rawValue.replace(/[^0-9.]/g, '');
    const dotIndex = filtered.indexOf('.');
    if (dotIndex !== -1) {
        filtered = filtered.substring(0, dotIndex + 1) + filtered.substring(dotIndex + 1).replace(/\./g, '');
    }
    if (filtered.length > 7) {
        filtered = filtered.substring(0, 7);
    }
    if (filtered !== rawValue) {
        inputX.value = filtered;
    }
    const active = selectedMaterial || selectedPromoTag;
    const x = parseFloat(inputX.value);
    
    if (!active || isNaN(x) || x <= 0) { resultBox.textContent = '0.0'; return; }
    
    let result;
    switch (active.material_type) {
        case 'BOTTLE':
            result = (x * 1000) / active.p1;
            break;
        case 'PUMP_CAP':
            const peel = peelMode === 'CARTON' ? active.t1 : peelMode === 'PLASTIC' ? active.t2 : 0;
            result = ((x - peel) * 1000) / active.p1;
            break;
        case 'LABEL': case 'PROMO_TAG':
            if (active.m <= active.c || active.q <= 0) { result = 0; break; }
            const n = active.q / (active.m - active.c);
            result = (x - active.c * rollCount) * n;
            break;
        default: result = 0;
    }
    resultBox.textContent = result > 0 ? result.toFixed(1) : '0.0';
}

function clearCalc() { inputX.value = ''; resultBox.textContent = '0.0'; }

function bottleTotal() {
    const x = parseFloat(inputX.value);
    if (!isNaN(x) && x > 0) {
        bottleAccum.expression += `${x}kg + `;
        bottleAccum.totalEA += parseFloat(resultBox.textContent) || 0;
        inputX.value = '';
        resultBox.textContent = '0.0';
        updateCalcUI();
        inputX.focus();
    }
}

// ==================== 促销标签对话框 ====================
let promoTagUsageMap = {};
// 从 IndexedDB 加载点击率
async function loadPromoUsageMap() {
    try {
        const saved = await getMeta('promo_usage_map');
        if (saved) {
            promoTagUsageMap = JSON.parse(saved);
        }
    } catch (e) {
        promoTagUsageMap = {};
    }
}

// 保存点击率到 IndexedDB
async function savePromoUsageMap() {
    try {
        await putMeta('promo_usage_map', JSON.stringify(promoTagUsageMap));
    } catch (e) {
        // 静默失败，不弹提示
    }
}

function openPromoDialog() {
    const dialog = document.getElementById('promo-dialog-overlay');
    const searchInput = document.getElementById('promo-search');
    searchInput.value = '';
    dialog.style.display = 'flex';
    renderPromoTags('');
    setTimeout(() => { searchInput.focus(); }, 100);
}

function closePromoDialog() {
    document.getElementById('promo-dialog-overlay').style.display = 'none';
    inputX.focus();
}

document.getElementById('promo-search').addEventListener('input', (e) => {
    renderPromoTags(e.target.value);
});

document.getElementById('promo-dialog-close').addEventListener('click', closePromoDialog);

document.getElementById('promo-dialog-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePromoDialog();
});

function renderPromoTags(query) {
    const grid = document.getElementById('promo-grid');
    const promos = materialsData.filter(m => m.material_type === 'PROMO_TAG');

    const sorted = promos.sort((a, b) => {
    const codeA = a.m_code || '';
    const codeB = b.m_code || '';
    const countA = promoTagUsageMap[codeA] || 0;
    const countB = promoTagUsageMap[codeB] || 0;
    return countB - countA || (b.updated_at || 0) - (a.updated_at || 0);
});

    const filtered = query 
        ? sorted.filter(t => (t.m_code || '').includes(query))
        : sorted;

    if (filtered.length === 0) {
        grid.innerHTML = '<div style="text-align:center;padding:20px;color:#888;">未找到匹配的Code</div>';
        return;
    }

    grid.innerHTML = filtered.map((t, i) => {
        const selected = selectedPromoTag?.id === t.id;
        const code = t.m_code || '未知';
        const displayCode = query 
            ? code.replace(new RegExp(`(${query})`, 'gi'), '<span style="color:#FF0000;font-weight:bold;">$1</span>')
            : code;
        const superscriptMap = {
            '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
            '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹'
        };
        const order = (i + 1).toString().split('').map(d => superscriptMap[d] || d).join('');
        return `
            <button class="promo-tag-btn ${selected ? 'selected' : ''}" data-promo-id="${t.id}">
                <span class="order">${order}</span>
                ${displayCode}
            </button>
        `;
    }).join('');

    grid.querySelectorAll('.promo-tag-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const promo = materialsData.find(m => m.id === parseInt(btn.dataset.promoId));
            selectPromoTag(promo);
            closePromoDialog();
        });
    });
}

function selectPromoTag(promo) {
    selectedPromoTag = promo;
    selectedMaterial = null;
    const mCode = promo.m_code || '';
if (mCode) {
    promoTagUsageMap[mCode] = (promoTagUsageMap[mCode] || 0) + 1;
}
    savePromoUsageMap();  // ✅ 持久化

    renderMaterials();

    promoCard.textContent = `促销标签: ${promo.m_code || '请选择代码'}`;
    promoCard.classList.add('active');

    inputX.value = '';
    resultBox.textContent = '0.0';

    updateCalcUI();
}

// ==================== 全局委托：点击规格按钮进入计算页面 ====================
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('grid-btn') && e.target.dataset.specId) {
        selectedSpecId = parseInt(e.target.dataset.specId);
        enterCalcPage();
    }
});

// ==================== 数值校验工具 ====================
function validateNumber(val, label, allowDecimal = true) {
    if (val === null || val.trim() === '') {
        return { valid: false, value: null, error: `${label}不能为空` };
    }
    const num = allowDecimal ? parseFloat(val) : parseInt(val, 10);
    if (isNaN(num)) {
        return { valid: false, value: null, error: `${label}必须为有效数字` };
    }
    if (num <= 0) {
        return { valid: false, value: null, error: `${label}必须为正数` };
    }
    const digits = val.replace('.', '').replace('-', '');
    if (digits.length > 8) {
        return { valid: false, value: null, error: `${label}最多8位数字` };
    }
    return { valid: true, value: num, error: null };
}

function validateInt(val, label) {
    if (val === null || val.trim() === '') {
        return { valid: false, value: null, error: `${label}不能为空` };
    }
    if (!/^\d+$/.test(val.trim())) {
        return { valid: false, value: null, error: `${label}必须为正整数` };
    }
    const num = parseInt(val, 10);
    if (num <= 0) {
        return { valid: false, value: null, error: `${label}必须为正整数` };
    }
    if (val.trim().length > 8) {
        return { valid: false, value: null, error: `${label}最多8位数字` };
    }
    return { valid: true, value: num, error: null };
}

// ==================== 子按钮事件委托 ====================
subOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.peel) {
        setPeel(btn.dataset.peel);
    } else if (btn.dataset.roll) {
        setRoll(parseInt(btn.dataset.roll));
    } else if (btn.dataset.action === 'bottleTotal') {
        bottleTotal();
    }
});

// ==================== 新增材料函数 ====================
function addLabelMaterial() { openMaterialEditor('LABEL'); }
function addPumpCapMaterial() { openMaterialEditor('PUMP_CAP'); }
function addBottleMaterial() { openMaterialEditor('BOTTLE'); }
function addPromoTagMaterial() { openMaterialEditor('PROMO_TAG'); }
// ==================== 材料编辑器状态 ====================
let materialEditMode = 'add';       // 'add' | 'edit'
let materialEditType = 'BOTTLE';    // 'BOTTLE' | 'PUMP_CAP' | 'LABEL' | 'PROMO_TAG'
let materialEditId = null;          // 编辑时存 id，新增时为 null    
    // ==================== 打开材料编辑器 ====================
function openMaterialEditor(type, matData = null) {
    materialEditType = type;
    const typeNames = { BOTTLE: '瓶子', PUMP_CAP: '泵盖', LABEL: '标签', PROMO_TAG: '促销标签' };
    
    if (matData) {
        materialEditMode = 'edit';
        materialEditId = matData.id;
        document.getElementById('material-edit-title').textContent = '编辑' + (typeNames[type] || '材料');
        document.getElementById('me-name').value = matData.custom_name || '';
        document.getElementById('me-code').value = matData.m_code || '';
        document.getElementById('me-p1').value = matData.p1 ?? '';
        document.getElementById('me-t1').value = matData.t1 ?? '';
        document.getElementById('me-t2').value = matData.t2 ?? '';
        document.getElementById('me-m').value = matData.m ?? '';
        document.getElementById('me-c').value = matData.c ?? '';
        document.getElementById('me-q').value = matData.q ?? '';
        document.getElementById('me-remark').value = matData.remark || '';
    } else {
        materialEditMode = 'add';
        materialEditId = null;
        document.getElementById('material-edit-title').textContent = '新增' + (typeNames[type] || '材料');
        document.getElementById('me-name').value = '';
        document.getElementById('me-code').value = '';
        document.getElementById('me-p1').value = '';
        document.getElementById('me-t1').value = '';
        document.getElementById('me-t2').value = '';
        document.getElementById('me-m').value = '';
        document.getElementById('me-c').value = '';
        document.getElementById('me-q').value = '';
        document.getElementById('me-remark').value = '';
    }
    
    // 显隐字段
    document.getElementById('me-row-name').style.display = (type === 'PROMO_TAG') ? 'none' : 'flex';
    document.getElementById('me-row-code').style.display = (type === 'PROMO_TAG') ? 'flex' : 'none';
    document.getElementById('me-row-p1').style.display = (type === 'BOTTLE' || type === 'PUMP_CAP') ? 'flex' : 'none';
    document.getElementById('me-row-t1').style.display = (type === 'PUMP_CAP') ? 'flex' : 'none';
    document.getElementById('me-row-t2').style.display = (type === 'PUMP_CAP') ? 'flex' : 'none';
    document.getElementById('me-row-m').style.display = (type === 'LABEL' || type === 'PROMO_TAG') ? 'flex' : 'none';
    document.getElementById('me-row-c').style.display = (type === 'LABEL' || type === 'PROMO_TAG') ? 'flex' : 'none';
    document.getElementById('me-row-q').style.display = (type === 'LABEL' || type === 'PROMO_TAG') ? 'flex' : 'none';
    document.getElementById('me-row-remark').style.display = 'flex';
    
    document.getElementById('material-edit-overlay').style.display = 'flex';
    document.getElementById('dropdown-menu').style.display = 'none';
    menuVisible = false;
}
    document.getElementById('me-btn-cancel').addEventListener('click', () => {
    document.getElementById('material-edit-overlay').style.display = 'none';
});
    document.getElementById('me-btn-save').addEventListener('click', async () => {
    const type = materialEditType;
    
    // 收集并校验字段
    let name = '', code = '', p1, t1, t2, m, c, q, remark = '';
    remark = document.getElementById('me-remark').value.trim();
    
    if (type === 'BOTTLE') {
        name = document.getElementById('me-name').value.trim();
        if (!name) { alert('名称不能为空'); return; }
        const p1Raw = document.getElementById('me-p1').value;
        const p1Check = validateNumber(p1Raw, 'P1');
        if (!p1Check.valid) { alert(p1Check.error); return; }
        p1 = p1Check.value;
    } else if (type === 'PUMP_CAP') {
        name = document.getElementById('me-name').value.trim();
        if (!name) { alert('名称不能为空'); return; }
        const p1Raw = document.getElementById('me-p1').value;
        const p1Check = validateNumber(p1Raw, 'P1');
        if (!p1Check.valid) { alert(p1Check.error); return; }
        p1 = p1Check.value;
        const t1Raw = document.getElementById('me-t1').value;
        const t1Check = validateNumber(t1Raw, 'T1');
        if (!t1Check.valid) { alert(t1Check.error); return; }
        t1 = t1Check.value;
        const t2Raw = document.getElementById('me-t2').value;
        const t2Check = validateNumber(t2Raw, 'T2');
        if (!t2Check.valid) { alert(t2Check.error); return; }
        t2 = t2Check.value;
    } else if (type === 'LABEL') {
        name = document.getElementById('me-name').value.trim();
        if (!name) { alert('名称不能为空'); return; }
        const mRaw = document.getElementById('me-m').value;
        const mCheck = validateNumber(mRaw, 'M');
        if (!mCheck.valid) { alert(mCheck.error); return; }
        m = mCheck.value;
        const cRaw = document.getElementById('me-c').value;
        const cCheck = validateNumber(cRaw, 'C');
        if (!cCheck.valid) { alert(cCheck.error); return; }
        c = cCheck.value;
        const qRaw = document.getElementById('me-q').value;
        const qCheck = validateInt(qRaw, 'Q');
        if (!qCheck.valid) { alert(qCheck.error); return; }
        q = qCheck.value;
    } else if (type === 'PROMO_TAG') {
        code = document.getElementById('me-code').value.trim();
        if (!code) { alert('标签CODE不能为空'); return; }
        if (!/^\d+$/.test(code)) { alert('标签CODE必须为纯数字'); return; }
        const mRaw = document.getElementById('me-m').value;
        const mCheck = validateNumber(mRaw, 'M');
        if (!mCheck.valid) { alert(mCheck.error); return; }
        m = mCheck.value;
        const cRaw = document.getElementById('me-c').value;
        const cCheck = validateNumber(cRaw, 'C');
        if (!cCheck.valid) { alert(cCheck.error); return; }
        c = cCheck.value;
        const qRaw = document.getElementById('me-q').value;
        const qCheck = validateInt(qRaw, 'Q');
        if (!qCheck.valid) { alert(qCheck.error); return; }
        q = qCheck.value;
    }
    
    // 构建 mat 对象
    const matObj = {
        spec_id: selectedSpecId,
        material_type: type,
        custom_name: name || `促销 ${code}`,
        remark: remark,
        updated_at: Math.floor(Date.now() / 1000)
    };
    if (type === 'BOTTLE') matObj.p1 = p1;
    if (type === 'PUMP_CAP') { matObj.p1 = p1; matObj.t1 = t1; matObj.t2 = t2; }
    if (type === 'LABEL') { matObj.m = m; matObj.c = c; matObj.q = q; }
        if (type === 'PROMO_TAG') { matObj.m_code = code; matObj.m = m; matObj.c = c; matObj.q = q; }
    
    const spec = specsData.find(s => s.id === selectedSpecId);
    const brand = brandsData.find(b => b.id === spec?.brand_id);
    const basePath = `${currentLine} 线 > ${brand?.name || ''} > ${spec?.name || ''} > ${matObj.custom_name}`;
    
    await openDB();
    
    if (materialEditMode === 'add') {
        // 新增
        const all = await getAll('materials');
        const maxId = all.reduce((max, m) => Math.max(max, m.id || 0), 0);
        matObj.id = maxId + 1;
        matObj.created_at = Math.floor(Date.now() / 1000);
        
        const tx = db.transaction('materials', 'readwrite');
        const store = tx.objectStore('materials');
        await new Promise((resolve, reject) => { const req = store.add(matObj); req.onsuccess = resolve; req.onerror = reject; });
        
        const logData = { type: 'INSERT', table: 'materials', path: basePath, data: {} };
        if (type === 'BOTTLE') logData.data = { p1: p1 };
        else if (type === 'PUMP_CAP') logData.data = { p1, t1, t2 };
        else if (type === 'LABEL') logData.data = { m, c, q };
        else logData.data = { m_code: code, m, c, q };
        
        await addLog({ operation_type: 'INSERT', table_name: 'materials',
            data_json: JSON.stringify(logData), created_at: Math.floor(Date.now()/1000) });
    } else {
        // 编辑
        const oldMat = materialsData.find(m => m.id === materialEditId);
        const changes = {};
        if (type === 'BOTTLE' && oldMat.p1 !== p1) changes.p1 = { old: oldMat.p1, new: p1 };
        if (type === 'PUMP_CAP') {
            if (oldMat.p1 !== p1) changes.p1 = { old: oldMat.p1, new: p1 };
            if (oldMat.t1 !== t1) changes.t1 = { old: oldMat.t1, new: t1 };
            if (oldMat.t2 !== t2) changes.t2 = { old: oldMat.t2, new: t2 };
        }
        if (type === 'LABEL') {
            if (oldMat.m !== m) changes.m = { old: oldMat.m, new: m };
            if (oldMat.c !== c) changes.c = { old: oldMat.c, new: c };
            if (oldMat.q !== q) changes.q = { old: oldMat.q, new: q };
        }
        if (type === 'PROMO_TAG') {
            if (oldMat.m_code !== code) changes.m_code = { old: oldMat.m_code, new: code };
            if (oldMat.m !== m) changes.m = { old: oldMat.m, new: m };
            if (oldMat.c !== c) changes.c = { old: oldMat.c, new: c };
            if (oldMat.q !== q) changes.q = { old: oldMat.q, new: q };
        }
        
        const updated = { ...oldMat, ...matObj, id: materialEditId };
        const tx = db.transaction('materials', 'readwrite');
        const store = tx.objectStore('materials');
        await new Promise((resolve, reject) => { const req = store.put(updated); req.onsuccess = resolve; req.onerror = reject; });
        
        if (Object.keys(changes).length > 0) {
            await addLog({ operation_type: 'UPDATE', table_name: 'materials',
                data_json: JSON.stringify({ type: 'UPDATE', table: 'materials', path: basePath, changes }),
                created_at: Math.floor(Date.now()/1000) });
        }
    }
    
    document.getElementById('material-edit-overlay').style.display = 'none';
    materialsData = await getAll('materials');
    renderMaterials();
    updateCalcUI();
    updateBadge();
});
