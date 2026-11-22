// Vucar Motorbike Marketplace AI Agent - Frontend Controller
let currentConversationId = 'c1';
let currentSender = 'buyer';
let activeInspectorTab = 'state';
let conversationCache = {};
let allListings = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadConversations();
  loadListings();
  loadTelemetry();
  loadEvaluation();
});

// Tab Navigation
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-view').forEach(view => view.classList.add('hidden'));

  const activeBtn = event ? event.currentTarget : null;
  if (activeBtn) activeBtn.classList.add('active');

  if (tabName === 'studio') {
    document.getElementById('viewStudio').classList.remove('hidden');
    loadConversationDetail(currentConversationId);
  } else if (tabName === 'inventory') {
    document.getElementById('viewInventory').classList.remove('hidden');
    renderInventory(allListings);
  } else if (tabName === 'telemetry') {
    document.getElementById('viewTelemetry').classList.remove('hidden');
    loadTelemetry();
  } else if (tabName === 'eval') {
    document.getElementById('viewEval').classList.remove('hidden');
    loadEvaluation();
  }
}

// Switch Inspector Sub-tabs
function switchInspectorTab(tab) {
  activeInspectorTab = tab;
  ['state', 'tools', 'raw'].forEach(t => {
    const btn = document.getElementById(`inspTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const view = document.getElementById(`inspView${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (t === tab) {
      btn.className = "px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-vucar-navy shadow-xs border border-slate-200";
      view.classList.remove('hidden');
    } else {
      btn.className = "px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-white/80";
      view.classList.add('hidden');
    }
  });
}

// Sender Switch
function setSender(sender) {
  currentSender = sender;
  const btnBuyer = document.getElementById('btnSenderBuyer');
  const btnSeller = document.getElementById('btnSenderSeller');

  if (sender === 'buyer') {
    btnBuyer.className = "px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white shadow-xs";
    btnSeller.className = "px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200";
  } else {
    btnBuyer.className = "px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200";
    btnSeller.className = "px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-600 text-white shadow-xs";
  }
}

// Load Conversations list
async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
    const data = await res.json();
    const list = data.conversations || [];
    renderConversationList(list);

    if (list.length > 0) {
      if (!list.some(c => c.conversation_id === currentConversationId)) {
        currentConversationId = list[0].conversation_id;
      }
      loadConversationDetail(currentConversationId);
    }
  } catch (err) {
    console.error("Failed to load conversations:", err);
  }
}

function renderConversationList(list) {
  const container = document.getElementById('conversationList');
  container.innerHTML = '';

  list.forEach(c => {
    const isActive = c.conversation_id === currentConversationId;
    const stageColor = getStageBadgeColor(c.lead_stage);

    const div = document.createElement('div');
    div.className = `p-3 rounded-xl border cursor-pointer transition-all ${
      isActive ? 'bg-blue-50/70 border-vucar-blue shadow-xs' : 'bg-white border-slate-200 hover:border-slate-300'
    }`;
    div.onclick = () => selectConversation(c.conversation_id);

    div.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <span class="font-bold text-xs ${isActive ? 'text-vucar-blue' : 'text-slate-800'}">
          #${c.conversation_id} • ${c.participants?.buyer_name || 'Người Mua'}
        </span>
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${stageColor}">
          ${c.lead_stage}
        </span>
      </div>
      <div class="text-[11px] text-slate-500 truncate mt-1">
        ${c.last_message || 'Bắt đầu hội thoại...'}
      </div>
      <div class="flex items-center justify-between text-[10px] text-slate-400 mt-2 pt-1.5 border-t border-slate-100">
        <span><i class="fa-solid fa-message mr-1"></i> ${c.turn_count} tin nhắn</span>
        ${c.risks_count > 0 ? `<span class="text-amber-600 font-bold"><i class="fa-solid fa-triangle-exclamation mr-0.5"></i> ${c.risks_count} rủi ro</span>` : '<span class="text-emerald-600 font-medium">Bình thường</span>'}
      </div>
    `;
    container.appendChild(div);
  });
}

function selectConversation(convId) {
  currentConversationId = convId;
  loadConversations();
}

// Load Conversation Detail
async function loadConversationDetail(convId) {
  try {
    const res = await fetch(`/api/conversations/${convId}`);
    if (!res.ok) return;
    const data = await res.json();
    conversationCache[convId] = data;

    // Update Header
    document.getElementById('activeConvBadge').innerText = convId;
    document.getElementById('activeConvTitle').innerText = `Hội thoại ${convId}`;
    document.getElementById('activeChannelBadge').innerText = data.state?.channel_id ? `Bridge: ${data.state.channel_id}` : 'Chưa tạo Bridge';
    document.getElementById('activeStageBadge').innerText = data.state?.lead_stage || 'DISCOVERY';
    document.getElementById('activeStageBadge').className = `px-2 py-0.5 rounded-full font-semibold text-[10px] ${getStageBadgeColor(data.state?.lead_stage)}`;

    // Escalation pill
    const escPill = document.getElementById('escalationPill');
    if (data.state?.escalated_to_human) {
      escPill.classList.remove('hidden');
      escPill.classList.add('flex');
    } else {
      escPill.classList.add('hidden');
      escPill.classList.remove('flex');
    }

    renderChatTimeline(data.messages || []);
    renderStructuredState(data.state);
  } catch (err) {
    console.error("Error loading conversation detail:", err);
  }
}

// Render 3-Way Chat Timeline
function renderChatTimeline(messages) {
  const container = document.getElementById('chatTimeline');
  container.innerHTML = '';

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center text-slate-400 text-xs">
        <i class="fa-regular fa-comments text-3xl mb-2"></i>
        <span>Chưa có tin nhắn trong phiên này. Hãy gửi tin nhắn đầu tiên!</span>
      </div>
    `;
    return;
  }

  messages.forEach(m => {
    const div = document.createElement('div');
    div.className = "chat-bubble flex items-start space-x-2.5 max-w-[92%]";

    if (m.sender === 'buyer') {
      div.className += " mr-auto";
      div.innerHTML = `
        <div class="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
          B
        </div>
        <div>
          <div class="flex items-center space-x-2 mb-0.5">
            <span class="text-[11px] font-bold text-blue-900">Người Mua (Buyer)</span>
            <span class="text-[10px] text-slate-400">${formatTime(m.timestamp)}</span>
          </div>
          <div class="bg-white border border-blue-200 text-slate-800 text-xs rounded-2xl rounded-tl-xs p-3 shadow-xs leading-relaxed">
            ${m.text}
          </div>
        </div>
      `;
    } else if (m.sender === 'seller') {
      div.className += " mr-auto";
      div.innerHTML = `
        <div class="w-7 h-7 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
          S
        </div>
        <div>
          <div class="flex items-center space-x-2 mb-0.5">
            <span class="text-[11px] font-bold text-amber-900">Người Bán (Seller)</span>
            <span class="text-[10px] text-slate-400">${formatTime(m.timestamp)}</span>
          </div>
          <div class="bg-amber-50/70 border border-amber-200 text-slate-800 text-xs rounded-2xl rounded-tl-xs p-3 shadow-xs leading-relaxed">
            ${m.text}
          </div>
        </div>
      `;
    } else {
      // AGENT (Vucar Branded Card)
      div.className = "chat-bubble w-full my-1";
      div.innerHTML = `
        <div class="bg-gradient-to-r from-blue-50/90 via-sky-50/60 to-white border border-blue-300 rounded-2xl p-3.5 shadow-xs">
          <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-blue-100">
            <div class="flex items-center space-x-2">
              <span class="w-5 h-5 rounded-md bg-vucar-navy text-white flex items-center justify-center font-black text-[10px]">V</span>
              <span class="text-xs font-extrabold text-vucar-navy tracking-tight">Vucar AI Marketplace Agent</span>
              <span class="px-2 py-0.2 rounded-full bg-blue-100 text-blue-800 font-bold text-[9px] uppercase">Hỗ trợ trung gian</span>
            </div>
            <span class="text-[10px] text-slate-400 font-mono">${formatTime(m.timestamp)}</span>
          </div>
          <div class="text-xs text-slate-800 leading-relaxed font-normal">
            ${m.text}
          </div>
        </div>
      `;
    }

    container.appendChild(div);
  });

  // Auto scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// Render Structured State Inspector
function renderStructuredState(state) {
  if (!state) return;

  // 1. Stage Stepper
  const stages = ['DISCOVERY', 'MATCHING', 'NEGOTIATION', 'APPOINTMENT', 'CLOSING'];
  const curStageIdx = stages.indexOf(state.lead_stage);
  const stepper = document.getElementById('stageStepper');
  stepper.innerHTML = '';

  stages.forEach((st, idx) => {
    let cls = 'future';
    if (idx === curStageIdx) cls = 'active';
    else if (idx < curStageIdx) cls = 'past';

    const div = document.createElement('div');
    div.className = `stepper-pill ${cls} text-center py-1 rounded-lg border text-[10px] font-bold`;
    div.innerText = st;
    stepper.appendChild(div);
  });

  // 2. Next Best Action
  const nba = state.next_best_action;
  if (nba) {
    document.getElementById('nbaTarget').innerText = nba.target || 'both';
    document.getElementById('nbaAction').innerText = nba.action || 'CLARIFY_PREFERENCE';
    document.getElementById('nbaRationale').innerText = nba.rationale || 'Đang hỗ trợ...';
  }

  // 3. Active Risks
  const risks = state.risks || [];
  const riskContainer = document.getElementById('risksContainer');
  document.getElementById('riskCountBadge').innerText = risks.length;
  riskContainer.innerHTML = '';

  if (risks.length === 0) {
    riskContainer.innerHTML = `
      <div class="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-800 text-[11px] flex items-center">
        <i class="fa-solid fa-circle-check mr-2 text-emerald-600"></i> Chưa phát hiện rủi ro giao dịch nào.
      </div>
    `;
  } else {
    risks.forEach(r => {
      const isCritical = r.level === 'CRITICAL' || r.level === 'HIGH';
      const div = document.createElement('div');
      div.className = `p-2.5 rounded-xl border ${isCritical ? 'bg-red-50/90 border-red-200 text-red-900' : 'bg-amber-50/80 border-amber-200 text-amber-900'}`;
      div.innerHTML = `
        <div class="flex items-center justify-between font-bold text-[11px] mb-1">
          <span><i class="fa-solid fa-triangle-exclamation mr-1"></i> [${r.category}]</span>
          <span class="px-1.5 py-0.2 rounded text-[9px] ${isCritical ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}">${r.level}</span>
        </div>
        <div class="text-[11px] leading-relaxed text-slate-700">${r.description}</div>
      `;
      riskContainer.appendChild(div);
    });
  }

  // 4. Constraints Checklist
  const c = state.constraints || {};
  const cCont = document.getElementById('constraintsContainer');
  cCont.innerHTML = `
    <div class="flex justify-between py-0.5 border-b border-slate-100">
      <span class="text-slate-500">Ngân sách (Budget):</span>
      <span class="font-bold text-slate-800">${c.budget_max ? formatVND(c.budget_max) : 'Chưa xác định'}</span>
    </div>
    <div class="flex justify-between py-0.5 border-b border-slate-100">
      <span class="text-slate-500">Khu vực:</span>
      <span class="font-bold text-slate-800">${c.location || 'TP. Hồ Chí Minh'}</span>
    </div>
    <div class="flex justify-between py-0.5 border-b border-slate-100">
      <span class="text-slate-500">Hãng ưu tiên:</span>
      <span class="font-bold text-slate-800">${(c.brands && c.brands.length) ? c.brands.join(', ') : 'Tất cả'}</span>
    </div>
    <div class="flex justify-between py-0.5 border-b border-slate-100">
      <span class="text-slate-500">Đời xe / ODO:</span>
      <span class="font-bold text-slate-800">${c.year_min ? 'Đời ' + c.year_min + '+' : 'Không rõ'} • ${c.max_odo ? '< ' + c.max_odo.toLocaleString() + ' km' : 'Odo thấp'}</span>
    </div>
    <div class="flex justify-between py-0.5">
      <span class="text-slate-500">Deal-breakers:</span>
      <span class="font-medium text-red-600 truncate max-w-[200px]">${(c.deal_breakers && c.deal_breakers.length) ? c.deal_breakers.join('; ') : 'Không có'}</span>
    </div>
  `;

  // 5. Listing Context
  const lc = state.listing_context || {};
  const lcCont = document.getElementById('listingContextDetails');
  lcCont.innerHTML = `
    <div class="font-bold text-slate-800 text-[11px] flex items-center justify-between">
      <span>${lc.brand || 'Xe'} ${lc.model || ''} (${lc.year || '2021'})</span>
      <span class="text-vucar-blue">${lc.asking_price ? formatVND(lc.asking_price) : ''}</span>
    </div>
    <div class="text-[10px] text-slate-500 mt-1">
      <strong>Giấy tờ:</strong> ${lc.paperwork_status || 'Chính chủ sang tên'}
    </div>
  `;

  // 6. Open Questions
  const oqList = document.getElementById('openQuestionsList');
  oqList.innerHTML = '';
  const oqs = state.open_questions || [];
  if (oqs.length === 0) {
    oqList.innerHTML = `<li class="text-slate-400">Không có câu hỏi nghẽn nào.</li>`;
  } else {
    oqs.forEach(q => {
      const li = document.createElement('li');
      li.innerText = q;
      oqList.appendChild(li);
    });
  }

  // 7. Rolling Summary
  document.getElementById('rollingSummaryText').innerText = state.summary || 'Chưa có tóm tắt.';

  // 8. Tool History
  const thList = document.getElementById('toolHistoryList');
  document.getElementById('toolCountBadge').innerText = (state.tool_history || []).length;
  thList.innerHTML = '';
  if (!state.tool_history || state.tool_history.length === 0) {
    thList.innerHTML = `<div class="text-slate-400 text-center py-4">Chưa có công cụ nào được gọi.</div>`;
  } else {
    state.tool_history.forEach(t => {
      const div = document.createElement('div');
      div.className = "p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px]";
      div.innerHTML = `
        <div class="flex items-center justify-between font-bold text-slate-800 mb-1">
          <span class="text-vucar-blue"><i class="fa-solid fa-terminal mr-1"></i> ${t.tool_name}()</span>
          <span class="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200 font-mono">200 OK</span>
        </div>
        <div class="text-slate-500 font-mono text-[10px] truncate">Args: ${JSON.stringify(t.arguments)}</div>
      `;
      thList.appendChild(div);
    });
  }

  // 9. Raw JSON
  document.getElementById('rawStateJson').innerText = JSON.stringify(state, null, 2);
}

// Handle Send Message
async function handleSendMessage(e) {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  const btnSend = document.getElementById('btnSend');
  btnSend.disabled = true;
  btnSend.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

  try {
    const res = await fetch(`/api/conversations/${currentConversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: currentSender, text: text })
    });

    if (res.ok) {
      await loadConversationDetail(currentConversationId);
      loadConversations();
      loadTelemetry();
    }
  } catch (err) {
    console.error("Failed to post message:", err);
  } finally {
    btnSend.disabled = false;
    btnSend.innerHTML = `<span>Gửi</span><i class="fa-solid fa-paper-plane text-xs"></i>`;
  }
}

function injectPrompt(sender, text) {
  setSender(sender);
  document.getElementById('chatInput').value = text;
}

// Create New Conversation
async function createNewConversation() {
  const newId = `c_${Date.now().toString().slice(-4)}`;
  currentConversationId = newId;

  // Send greeting to init
  await fetch(`/api/conversations/${newId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: 'buyer',
      text: 'Chào Vucar, mình muốn tìm xe máy cũ chạy lướt tầm 20-30tr ở Sài Gòn.'
    })
  });

  loadConversations();
}

// Reset data
async function resetConversations() {
  if (confirm("Khôi phục toàn bộ hội thoại về trạng thái mẫu (c1, c2, c3)?")) {
    await fetch('/api/conversations/reset', { method: 'POST' });
    currentConversationId = 'c1';
    loadConversations();
  }
}

// Inventory Database View
async function loadListings() {
  try {
    const res = await fetch('/api/listings');
    const data = await res.json();
    allListings = data.listings || [];
  } catch (err) {
    console.error("Error loading listings:", err);
  }
}

function renderInventory(items) {
  const grid = document.getElementById('inventoryGrid');
  grid.innerHTML = '';

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = "bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:shadow-md transition-all";
    div.innerHTML = `
      <div class="h-36 bg-slate-100 relative">
        <img src="${item.image_url}" alt="${item.model}" class="w-full h-full object-cover">
        ${item.vucar_certified ? `
          <span class="absolute top-2 left-2 bg-vucar-blue text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-xs">
            <i class="fa-solid fa-certificate mr-1"></i> Vucar Certified
          </span>
        ` : ''}
        <span class="absolute bottom-2 right-2 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">
          Điểm kiểm định: ${item.inspection_score}/100
        </span>
      </div>
      <div class="p-4">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-500 uppercase">${item.brand} • ${item.year}</span>
          <span class="text-sm font-black text-vucar-blue">${formatVND(item.price)}</span>
        </div>
        <h3 class="text-sm font-bold text-slate-800 mt-0.5">${item.model}</h3>
        <p class="text-xs text-slate-500 line-clamp-2 mt-1">${item.description}</p>
        <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
          <span><i class="fa-solid fa-gauge mr-1 text-slate-400"></i> ${item.odo?.toLocaleString()} km</span>
          <span><i class="fa-solid fa-location-dot mr-1 text-slate-400"></i> ${item.district}</span>
        </div>
        <div class="mt-2 text-[10px] p-1.5 bg-slate-50 rounded-lg text-slate-600 truncate">
          <strong>Pháp lý:</strong> ${item.paperwork_status}
        </div>
      </div>
    `;
    grid.appendChild(div);
  });
}

function filterInventory() {
  const kw = document.getElementById('inventorySearchInput').value.toLowerCase();
  const filtered = allListings.filter(l => {
    return l.brand.toLowerCase().includes(kw) ||
           l.model.toLowerCase().includes(kw) ||
           l.description.toLowerCase().includes(kw) ||
           l.location.toLowerCase().includes(kw);
  });
  renderInventory(filtered);
}

// Telemetry Audit Table
async function loadTelemetry() {
  try {
    const res = await fetch('/api/events');
    const data = await res.json();
    const tbody = document.getElementById('telemetryTableBody');
    tbody.innerHTML = '';

    const events = (data.events || []).slice(-25).reverse();
    events.forEach(e => {
      const tr = document.createElement('tr');
      tr.className = "hover:bg-slate-50/80";
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-mono text-[10px] text-slate-500">${formatTime(e.timestamp)}</td>
        <td class="py-2.5 px-3 font-bold text-slate-700">#${e.conversation_id}</td>
        <td class="py-2.5 px-3">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${getEventBadgeClass(e.event_type)}">
            ${e.event_type}
          </span>
        </td>
        <td class="py-2.5 px-3 text-slate-600 font-medium">${e.actor}</td>
        <td class="py-2.5 px-3 font-mono text-[10px] text-slate-600 max-w-xs truncate" title='${JSON.stringify(e.payload)}'>
          ${JSON.stringify(e.payload)}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loading telemetry:", err);
  }
}

// Evaluation View
async function loadEvaluation() {
  try {
    const res = await fetch('/api/eval');
    const data = await res.json();

    // Metrics
    if (data.task_success) {
      document.getElementById('metricMatchRate').innerText = data.task_success.match_success_rate;
      document.getElementById('metricBookingRate').innerText = data.task_success.appointment_booking_rate;
      document.getElementById('metricEscalationAcc').innerText = data.task_success.escalation_accuracy;
    }
    if (data.quality) {
      document.getElementById('metricSlotCoverage').innerText = data.quality.slot_coverage_rate;
    }

    // Error Analysis Cases
    const errContainer = document.getElementById('errorAnalysisList');
    errContainer.innerHTML = '';
    (data.error_analysis_cases || []).forEach(c => {
      const div = document.createElement('div');
      div.className = "p-4 rounded-xl border border-slate-200 bg-slate-50/60";
      div.innerHTML = `
        <div class="flex items-center justify-between mb-1.5">
          <span class="font-bold text-slate-900 text-xs">${c.case_id}: ${c.symptom}</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-red-100 text-red-800 font-bold">${c.failure_category}</span>
        </div>
        <p class="text-xs text-slate-600 mb-2">${c.description}</p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] pt-2 border-t border-slate-200">
          <div><strong class="text-red-700">Nguyên nhân thất bại:</strong> ${c.why_it_failed}</div>
          <div><strong class="text-amber-700">Tín hiệu bị bỏ sót:</strong> ${c.missing_signal}</div>
          <div><strong class="text-emerald-700">Giải pháp khắc phục:</strong> ${c.how_to_fix}</div>
        </div>
      `;
      errContainer.appendChild(div);
    });

    // Feedback Loop Dataset
    const fbContainer = document.getElementById('feedbackLoopList');
    fbContainer.innerHTML = '';
    (data.feedback_records || []).forEach(f => {
      const div = document.createElement('div');
      div.className = "p-3 rounded-xl border border-slate-200 bg-white flex items-start justify-between";
      div.innerHTML = `
        <div>
          <div class="flex items-center space-x-2 text-xs font-bold text-slate-800">
            <span>#${f.conversation_id}</span>
            <span class="text-emerald-600 bg-emerald-50 px-2 py-0.2 rounded-full border border-emerald-200">${f.outcome}</span>
            <span class="text-slate-400 font-normal">${f.timestamp.slice(0, 10)}</span>
          </div>
          <div class="text-xs text-slate-600 mt-1">
            <strong>Hành động:</strong> ${f.action_taken}
          </div>
          <div class="text-[11px] text-slate-500 italic mt-0.5">
            "${f.notes || 'Outcome ghi nhận từ thực địa.'}"
          </div>
        </div>
        <div class="text-amber-500 text-xs font-bold">
          ${'⭐'.repeat(f.user_satisfaction_score || 5)}
        </div>
      `;
      fbContainer.appendChild(div);
    });

  } catch (err) {
    console.error("Error loading eval data:", err);
  }
}

// Config Modal Handlers
function openConfigModal() {
  document.getElementById('configModal').classList.remove('hidden');
}
function closeConfigModal() {
  document.getElementById('configModal').classList.add('hidden');
}
async function saveConfig() {
  const key = document.getElementById('cfgApiKey').value.trim();
  const model = document.getElementById('cfgModel').value;

  if (key) localStorage.setItem('vucar_gemini_key', key);
  localStorage.setItem('vucar_gemini_model', model);

  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gemini_api_key: key, gemini_model: model })
  });

  document.getElementById('currentModelLabel').innerText = model;
  closeConfigModal();
  alert("Đã lưu cấu hình Gemini thành công!");
}

async function loadConfig() {
  const savedKey = localStorage.getItem('vucar_gemini_key') || '';
  const savedModel = localStorage.getItem('vucar_gemini_model') || 'gemini-2.5-flash';

  document.getElementById('cfgApiKey').value = savedKey;
  document.getElementById('cfgModel').value = savedModel;
  document.getElementById('currentModelLabel').innerText = savedModel;

  if (savedKey) {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gemini_api_key: savedKey, gemini_model: savedModel })
    });
  }
}

// Feedback Modal Handlers
function openFeedbackModal() {
  document.getElementById('feedbackModal').classList.remove('hidden');
  const state = conversationCache[currentConversationId]?.state;
  if (state?.next_best_action) {
    document.getElementById('fbAction').value = state.next_best_action.action;
  }
}
function closeFeedbackModal() {
  document.getElementById('feedbackModal').classList.add('hidden');
}
async function submitFeedbackRecord() {
  const outcome = document.getElementById('fbOutcome').value;
  const action = document.getElementById('fbAction').value || 'ACTION_TAKEN';
  const score = parseInt(document.getElementById('fbScore').value);
  const notes = document.getElementById('fbNotes').value;

  await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: currentConversationId,
      action_taken: action,
      outcome: outcome,
      score: score,
      notes: notes
    })
  });

  closeFeedbackModal();
  loadEvaluation();
  alert("Đã ghi nhận Feedback vào bộ dữ liệu huấn luyện!");
}

// Helpers
function formatVND(num) {
  if (!num) return '0 đ';
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace('.0', '') + ' triệu đ';
  return num.toLocaleString() + ' đ';
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function getStageBadgeColor(stage) {
  switch (stage) {
    case 'DISCOVERY': return 'bg-slate-100 text-slate-700';
    case 'MATCHING': return 'bg-blue-100 text-blue-700';
    case 'NEGOTIATION': return 'bg-amber-100 text-amber-800';
    case 'APPOINTMENT': return 'bg-purple-100 text-purple-700';
    case 'CLOSING': return 'bg-emerald-100 text-emerald-800';
    case 'DROPPED': return 'bg-red-100 text-red-700';
    default: return 'bg-slate-100 text-slate-700';
  }
}

function getEventBadgeClass(type) {
  switch (type) {
    case 'USER_MESSAGE': return 'bg-blue-50 text-blue-700 border border-blue-200';
    case 'AGENT_ACTION': return 'bg-indigo-50 text-indigo-700 border border-indigo-200';
    case 'TOOL_CALL': return 'bg-slate-100 text-slate-800 border border-slate-300';
    case 'STATE_UPDATE': return 'bg-purple-50 text-purple-700 border border-purple-200';
    case 'ESCALATION': return 'bg-red-100 text-red-800 border border-red-300';
    default: return 'bg-slate-50 text-slate-600';
  }
}
