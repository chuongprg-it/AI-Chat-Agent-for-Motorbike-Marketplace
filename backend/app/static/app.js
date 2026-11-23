// Vucar Motorbike Marketplace AI Agent - Frontend Controller
let currentConversationId = 'c1';
let currentSender = 'buyer';
let activeInspectorTab = 'state';
let conversationCache = {};
let allListings = [];
let salesHandoffActive = {}; // per-conversation sales hand-off flag

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadConversations();
  loadListings();
  loadToolsCatalog();
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
  const btnBuyer  = document.getElementById('btnSenderBuyer');
  const btnSeller = document.getElementById('btnSenderSeller');
  const btnSales  = document.getElementById('btnSenderSales');

  // Reset all
  [btnBuyer, btnSeller, btnSales].forEach(btn => {
    if (btn) btn.className = "px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200";
  });

  if (sender === 'buyer' && btnBuyer) {
    btnBuyer.className = "px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white shadow-xs";
  } else if (sender === 'seller' && btnSeller) {
    btnSeller.className = "px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-600 text-white shadow-xs";
  } else if (sender === 'sales' && btnSales) {
    btnSales.className = "px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-700 text-white shadow-xs";
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

    // Sales hand-off pill
    const salesPill = document.getElementById('salesHandoffPill');
    const hasSalesHandoff = data.state?.sales_handoff === true
      || (data.messages || []).some(m => m.sender === 'sales');

    salesHandoffActive[convId] = hasSalesHandoff;

    if (salesPill) {
      if (hasSalesHandoff) {
        salesPill.classList.remove('hidden');
        salesPill.classList.add('flex');
      } else {
        salesPill.classList.add('hidden');
        salesPill.classList.remove('flex');
      }
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
    } else if (m.sender === 'sales') {
      // SALES Agent (Human) bubble — green-branded card
      div.className = "chat-bubble w-full my-1";
      div.innerHTML = `
        <div class="bg-gradient-to-r from-emerald-50/90 via-green-50/60 to-white border border-emerald-300 rounded-2xl p-3.5 shadow-xs">
          <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-emerald-100">
            <div class="flex items-center space-x-2">
              <span class="w-5 h-5 rounded-md bg-emerald-700 text-white flex items-center justify-center font-black text-[10px]">SC</span>
              <span class="text-xs font-extrabold text-emerald-900 tracking-tight">Sales Vucar</span>
              <span class="px-2 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[9px] uppercase">Hỗ trợ trực tiếp</span>
            </div>
            <span class="text-[10px] text-slate-400 font-mono">${formatTime(m.timestamp)}</span>
          </div>
          <div class="text-xs text-slate-800 leading-relaxed font-normal">
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
            ${formatChatMessage(m.text)}
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

  const senderSending = currentSender;
  input.value = '';

  // 1. Optimistic UI update: instantly append user bubble into chat timeline!
  const container = document.getElementById('chatTimeline');
  const optimisticDiv = document.createElement('div');
  optimisticDiv.className = "chat-bubble flex items-start space-x-2.5 max-w-[92%] mr-auto";
  const now = new Date().toISOString();
  if (senderSending === 'buyer') {
    optimisticDiv.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">B</div>
      <div>
        <div class="flex items-center space-x-2 mb-0.5">
          <span class="text-[11px] font-bold text-blue-900">Người Mua (Buyer)</span>
          <span class="text-[10px] text-slate-400">${formatTime(now)}</span>
        </div>
        <div class="bg-white border border-blue-200 text-slate-800 text-xs rounded-2xl rounded-tl-xs p-3 shadow-xs leading-relaxed">${text}</div>
      </div>
    `;
  } else if (senderSending === 'seller') {
    optimisticDiv.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">S</div>
      <div>
        <div class="flex items-center space-x-2 mb-0.5">
          <span class="text-[11px] font-bold text-amber-900">Người Bán (Seller)</span>
          <span class="text-[10px] text-slate-400">${formatTime(now)}</span>
        </div>
        <div class="bg-amber-50/70 border border-amber-200 text-slate-800 text-xs rounded-2xl rounded-tl-xs p-3 shadow-xs leading-relaxed">${text}</div>
      </div>
    `;
  } else if (senderSending === 'sales') {
    optimisticDiv.className = "chat-bubble w-full my-1";
    optimisticDiv.innerHTML = `
      <div class="bg-gradient-to-r from-emerald-50/90 via-green-50/60 to-white border border-emerald-300 rounded-2xl p-3.5 shadow-xs">
        <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-emerald-100">
          <div class="flex items-center space-x-2">
            <span class="w-5 h-5 rounded-md bg-emerald-700 text-white flex items-center justify-center font-black text-[10px]">SC</span>
            <span class="text-xs font-extrabold text-emerald-900 tracking-tight">Sales Vucar</span>
            <span class="px-2 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[9px] uppercase">Hỗ trợ trực tiếp</span>
          </div>
          <span class="text-[10px] text-slate-400 font-mono">${formatTime(now)}</span>
        </div>
        <div class="text-xs text-slate-800 leading-relaxed font-normal">${text}</div>
      </div>
    `;
  }
  container.appendChild(optimisticDiv);

  // Typing indicator placeholder
  const typingDiv = document.createElement('div');
  typingDiv.id = "tempTypingIndicator";
  typingDiv.className = "chat-bubble w-full my-1";
  typingDiv.innerHTML = `
    <div class="bg-white/80 border border-slate-200 rounded-2xl p-3 shadow-xs flex items-center space-x-2 text-xs text-slate-500">
      <span class="w-4 h-4 border-2 border-vucar-blue border-t-transparent rounded-full animate-spin"></span>
      <span>Vucar AI Agent đang phân tích và tìm kiếm phương án...</span>
    </div>
  `;
  container.appendChild(typingDiv);
  container.scrollTop = container.scrollHeight;

  const btnSend = document.getElementById('btnSend');
  btnSend.disabled = true;

  try {
    const res = await fetch(`/api/conversations/${currentConversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: senderSending, text: text })
    });

    if (res.ok) {
      await loadConversationDetail(currentConversationId);
      loadConversations();
    }
  } catch (err) {
    console.error("Failed to post message:", err);
  } finally {
    const typing = document.getElementById("tempTypingIndicator");
    if (typing) typing.remove();
    btnSend.disabled = false;
    btnSend.innerHTML = `<span>Gửi</span><i class="fa-solid fa-paper-plane text-xs"></i>`;
  }
}

function injectPrompt(sender, text) {
  setSender(sender);
  document.getElementById('chatInput').value = text;
}

// Create New Conversation (Clean / Empty Slate)
async function createNewConversation() {
  const newId = `c_${Date.now().toString().slice(-4)}`;
  currentConversationId = newId;

  // Immediate clean slate on UI
  document.getElementById('activeConvBadge').innerText = newId;
  document.getElementById('activeConvTitle').innerText = `Hội thoại ${newId}`;
  document.getElementById('activeChannelBadge').innerText = 'Chưa tạo Bridge';
  document.getElementById('activeStageBadge').innerText = 'DISCOVERY';
  document.getElementById('activeStageBadge').className = `px-2 py-0.5 rounded-full font-semibold text-[10px] ${getStageBadgeColor('DISCOVERY')}`;

  const escPill = document.getElementById('escalationPill');
  if (escPill) escPill.classList.add('hidden');
  const salesPill = document.getElementById('salesHandoffPill');
  if (salesPill) salesPill.classList.add('hidden');

  // Render completely empty chat view ready for custom scenario
  renderChatTimeline([]);

  // Fetch or initialize on backend
  try {
    await fetch(`/api/conversations/${newId}`);
  } catch (e) {
    console.error("Init error:", e);
  }

  await loadConversationDetail(newId);
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

// Inventory & Tools View
let allToolsCatalog = [];

async function loadToolsCatalog() {
  try {
    const res = await fetch('/api/tools');
    const data = await res.json();
    allToolsCatalog = data.tools || [];
    renderToolsCatalog(allToolsCatalog);
  } catch (err) {
    console.error("Error loading tools catalog:", err);
  }
}

function renderToolsCatalog(tools) {
  const grid = document.getElementById('toolsCatalogGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const toolMeta = {
    'search_listings': {
      icon: 'fa-magnifying-glass',
      color: 'blue',
      forWhom: 'Hỗ trợ Người Mua & Agent',
      benefits: 'Lọc kho xe theo ngân sách, dòng xe, năm sản xuất và ODO để đưa ra các lựa chọn tốt nhất',
      whenCalled: 'Khi người mua chia sẻ tiêu chí hoặc khi đàm phán giá cần phương án thay thế'
    },
    'get_listing_detail': {
      icon: 'fa-file-lines',
      color: 'indigo',
      forWhom: 'Hỗ trợ Người Mua & Thẩm định',
      benefits: 'Tra cứu sâu điểm kiểm định 120 điểm, tình trạng giấy tờ pháp lý và lịch sử xe',
      whenCalled: 'Khi người mua quan tâm một tin đăng cụ thể cần làm rõ thông tin chi tiết'
    },
    'create_chat_bridge': {
      icon: 'fa-bridge',
      color: 'emerald',
      forWhom: 'Bảo vệ cả Người Mua & Người Bán',
      benefits: 'Tạo phòng chat an toàn 3 bên, che số điện thoại riêng và kích hoạt cơ chế bảo vệ giao dịch',
      whenCalled: 'Khi hai bên bắt đầu khớp nhu cầu hoặc khi phát hiện nguy cơ người bán muốn bypass sàn'
    },
    'book_appointment': {
      icon: 'fa-calendar-check',
      color: 'purple',
      forWhom: 'Hỗ trợ Người Mua, Người Bán & KTV Vucar',
      benefits: 'Đặt lịch hẹn xem xe thực tế tận nơi hoặc tại Vucar Hub với kỹ thuật viên kiểm định đi kèm',
      whenCalled: 'Khi cả hai bên đã thống nhất thời gian và địa điểm gặp mặt xem xe'
    },
    'log_event': {
      icon: 'fa-clock-rotate-left',
      color: 'amber',
      forWhom: 'Hệ thống Quản trị & Đội ngũ Ops',
      benefits: 'Ghi lại mọi diễn biến quan trọng (tin nhắn, gọi tool, chuyển stage, escalate) để kiểm toán',
      whenCalled: 'Tự động kích hoạt ở mọi bước chuyển biến trong cuộc hội thoại'
    }
  };

  tools.forEach(t => {
    const meta = toolMeta[t.name] || {
      icon: 'fa-gear',
      color: 'slate',
      forWhom: 'Agent & Hệ thống',
      benefits: t.description,
      whenCalled: 'Khi có sự kiện phù hợp'
    };

    const paramKeys = Object.keys(t.parameters?.properties || {});
    const div = document.createElement('div');
    div.className = `p-4 rounded-2xl border border-slate-200 bg-white hover:border-${meta.color}-400 hover:shadow-md transition-all flex flex-col justify-between`;
    div.title = `Tính năng: ${t.name}()\n• Hỗ trợ cho: ${meta.forWhom}\n• Lợi ích: ${meta.benefits}\n• Kích hoạt khi: ${meta.whenCalled}`;

    div.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center space-x-2">
            <span class="w-8 h-8 rounded-xl bg-${meta.color}-50 text-${meta.color}-600 border border-${meta.color}-200 flex items-center justify-center text-xs font-bold shadow-xs">
              <i class="fa-solid ${meta.icon}"></i>
            </span>
            <span class="font-mono font-bold text-xs text-slate-800">${t.name}()</span>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-${meta.color}-100 text-${meta.color}-800">API Tool</span>
        </div>
        <p class="text-[11px] text-slate-600 leading-relaxed mb-3">${t.description}</p>
        
        <div class="space-y-1.5 text-[10px] bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <div><strong class="text-blue-900"><i class="fa-solid fa-user-check mr-1 text-vucar-blue"></i>Hỗ trợ:</strong> <span class="text-slate-700">${meta.forWhom}</span></div>
          <div><strong class="text-emerald-900"><i class="fa-solid fa-bolt mr-1 text-emerald-600"></i>Lợi ích:</strong> <span class="text-slate-700">${meta.benefits}</span></div>
          <div><strong class="text-amber-900"><i class="fa-solid fa-clock mr-1 text-amber-600"></i>Khi nào gọi:</strong> <span class="text-slate-700">${meta.whenCalled}</span></div>
        </div>
      </div>

      <div class="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-mono">
        <span>Params: ${paramKeys.length} trường</span>
        <span class="text-vucar-blue font-semibold hover:underline cursor-pointer" onclick="openToolDetailModal('${t.name}')">Chi tiết Schema →</span>
      </div>
    `;
    grid.appendChild(div);
  });
}

function openToolDetailModal(toolName) {
  const t = allToolsCatalog.find(x => x.name === toolName);
  if (!t) return;
  document.getElementById('modalEventId').innerText = `Tool Schema: ${t.name}()`;
  document.getElementById('modalPayloadJson').innerText = JSON.stringify(t, null, 2);
  document.getElementById('payloadDetailModal').classList.remove('hidden');
}

// Inventory Database View
async function loadListings() {
  try {
    const res = await fetch('/api/listings');
    const data = await res.json();
    allListings = data.listings || [];
    const badge = document.getElementById('inventoryCountBadge');
    if (badge) badge.innerText = `${allListings.length} Xe Sẵn Sàng`;
    renderInventory(allListings);
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
    div.title = `Xe: ${item.brand} ${item.model} (${item.year})\n• Hỗ trợ cho: Người Mua tìm xe & Người Bán ký gửi\n• Tình trạng: ${item.paperwork_status}\n• ODO: ${item.odo?.toLocaleString()} km - Giá: ${formatVND(item.price)}`;

    div.innerHTML = `
      <div class="h-36 bg-slate-100 relative overflow-hidden">
        <img src="${item.image_url}" alt="${item.model}" class="w-full h-full object-cover hover:scale-105 transition-all duration-300">
        ${item.vucar_certified ? `
          <span class="absolute top-2 left-2 bg-vucar-blue text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-xs" title="Đã qua kiểm định 120 điểm kỹ thuật độc quyền của Vucar">
            <i class="fa-solid fa-certificate mr-1"></i> Vucar Certified
          </span>
        ` : ''}
        <span class="absolute bottom-2 right-2 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-md" title="Điểm số đánh giá chất lượng máy móc, khung sườn và thẩm mỹ">
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
          <span title="Số kilomet đã lăn bánh thực tế"><i class="fa-solid fa-gauge mr-1 text-slate-400"></i> ${item.odo?.toLocaleString()} km</span>
          <span title="Khu vực đăng bán và xem xe"><i class="fa-solid fa-location-dot mr-1 text-slate-400"></i> ${item.district}</span>
        </div>
        <div class="mt-2 text-[10px] p-1.5 bg-slate-50 rounded-lg text-slate-600 truncate" title="Tình trạng pháp lý giấy tờ xe">
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
let telemetryShowAll = false;
let cachedTelemetryEvents = [];

function toggleTelemetryLimit() {
  telemetryShowAll = !telemetryShowAll;
  const btnLabel = document.getElementById('telemetryLimitLabel');
  if (telemetryShowAll) {
    btnLabel.innerText = "Thu Gọn (Hiện 25 Event Mới Nhất)";
  } else {
    btnLabel.innerText = "Xem Full Tất Cả Event";
  }
  renderTelemetryTable();
}

async function loadTelemetry() {
  try {
    const res = await fetch('/api/events');
    const data = await res.json();
    cachedTelemetryEvents = data.events || [];
    renderTelemetryTable();
  } catch (err) {
    console.error("Error loading telemetry:", err);
  }
}

function renderTelemetryTable() {
  const tbody = document.getElementById('telemetryTableBody');
  tbody.innerHTML = '';

  const allEvents = [...cachedTelemetryEvents].reverse();
  const events = telemetryShowAll ? allEvents : allEvents.slice(0, 25);

  events.forEach((e, idx) => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50/80 transition-all";
    const payloadStr = JSON.stringify(e.payload || {});
    tr.innerHTML = `
      <td class="py-2.5 px-3 font-mono text-[10px] text-slate-500">${formatTime(e.timestamp)}</td>
      <td class="py-2.5 px-3 font-bold text-slate-700">#${e.conversation_id}</td>
      <td class="py-2.5 px-3">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${getEventBadgeClass(e.event_type)}">
          ${e.event_type}
        </span>
      </td>
      <td class="py-2.5 px-3 text-slate-600 font-medium">${e.actor}</td>
      <td class="py-2.5 px-3 font-mono text-[10px] text-slate-600 max-w-xs">
        <div class="flex items-center justify-between space-x-2">
          <span class="truncate flex-1" title='${payloadStr}'>${payloadStr}</span>
          <button onclick="openPayloadModal(${idx})" class="text-[10px] text-vucar-blue hover:underline font-sans font-semibold shrink-0">
            Full JSON
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openPayloadModal(eventIdx) {
  const allEvents = [...cachedTelemetryEvents].reverse();
  const e = allEvents[eventIdx];
  if (!e) return;

  document.getElementById('modalEventId').innerText = `#${e.event_id} • ${e.event_type}`;
  document.getElementById('modalPayloadJson').innerText = JSON.stringify(e, null, 2);
  document.getElementById('payloadDetailModal').classList.remove('hidden');
}

function closePayloadModal() {
  document.getElementById('payloadDetailModal').classList.add('hidden');
}

// Full Chat Modal
function openFullChatModal() {
  const data = conversationCache[currentConversationId];
  if (!data) return;

  const messages = data.messages || [];
  document.getElementById('modalChatCount').innerText = messages.length;
  const container = document.getElementById('modalChatTimeline');
  container.innerHTML = '';

  messages.forEach(m => {
    const div = document.createElement('div');
    div.className = "p-3 rounded-2xl border text-xs leading-relaxed space-y-1";

    if (m.sender === 'buyer') {
      div.className += " bg-blue-50/70 border-blue-200 text-slate-800";
      div.innerHTML = `
        <div class="flex items-center justify-between font-bold text-blue-900 text-[11px]">
          <span><i class="fa-solid fa-user mr-1 text-blue-600"></i> Người Mua (Buyer)</span>
          <span class="text-[10px] text-slate-400 font-normal font-mono">${formatTime(m.timestamp)}</span>
        </div>
        <div class="mt-1">${m.text}</div>
      `;
    } else if (m.sender === 'seller') {
      div.className += " bg-amber-50/70 border-amber-200 text-slate-800";
      div.innerHTML = `
        <div class="flex items-center justify-between font-bold text-amber-900 text-[11px]">
          <span><i class="fa-solid fa-shop mr-1 text-amber-600"></i> Người Bán (Seller)</span>
          <span class="text-[10px] text-slate-400 font-normal font-mono">${formatTime(m.timestamp)}</span>
        </div>
        <div class="mt-1">${m.text}</div>
      `;
    } else if (m.sender === 'sales') {
      div.className += " bg-emerald-50/80 border-emerald-300 text-emerald-950";
      div.innerHTML = `
        <div class="flex items-center justify-between font-bold text-emerald-900 text-[11px]">
          <span><i class="fa-solid fa-headset mr-1 text-emerald-700"></i> Sales Vucar</span>
          <span class="text-[10px] text-slate-400 font-normal font-mono">${formatTime(m.timestamp)}</span>
        </div>
        <div class="mt-1">${m.text}</div>
      `;
    } else {
      div.className += " bg-gradient-to-r from-blue-50 via-sky-50 to-white border-blue-300 text-slate-900 shadow-xs";
      div.innerHTML = `
        <div class="flex items-center justify-between font-extrabold text-vucar-navy text-[11px] pb-1 border-b border-blue-100">
          <span><i class="fa-solid fa-robot mr-1 text-vucar-blue"></i> Vucar AI Marketplace Agent</span>
          <span class="text-[10px] text-slate-400 font-normal font-mono">${formatTime(m.timestamp)}</span>
        </div>
        <div class="mt-1">${formatChatMessage(m.text)}</div>
      `;
    }
    container.appendChild(div);
  });

  document.getElementById('fullChatModal').classList.remove('hidden');
}

function closeFullChatModal() {
  document.getElementById('fullChatModal').classList.add('hidden');
}

// Full Tools Modal
function openFullToolsModal() {
  const data = conversationCache[currentConversationId];
  const toolHistory = data?.state?.tool_history || [];
  document.getElementById('modalToolCount').innerText = toolHistory.length;
  const container = document.getElementById('modalToolsContent');
  container.innerHTML = '';

  if (toolHistory.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs">Chưa có công cụ nào được gọi trong phiên này.</div>`;
  } else {
    toolHistory.forEach((t, i) => {
      const div = document.createElement('div');
      div.className = "p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2";
      div.innerHTML = `
        <div class="flex items-center justify-between font-bold text-slate-800 pb-2 border-b border-slate-200">
          <span class="text-vucar-blue flex items-center space-x-2">
            <span class="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px]">${i+1}</span>
            <span class="font-mono">${t.tool_name}()</span>
          </span>
          <span class="text-[10px] font-mono text-slate-400">${t.timestamp ? formatTime(t.timestamp) : ''}</span>
        </div>
        <div>
          <div class="font-bold text-[11px] text-slate-600 mb-1">Input Arguments:</div>
          <pre class="p-2.5 bg-slate-900 text-amber-300 rounded-xl font-mono text-[10px] overflow-x-auto">${JSON.stringify(t.arguments, null, 2)}</pre>
        </div>
        <div>
          <div class="font-bold text-[11px] text-slate-600 mb-1">Output Result:</div>
          <pre class="p-2.5 bg-slate-900 text-emerald-400 rounded-xl font-mono text-[10px] overflow-x-auto max-h-48">${JSON.stringify(t.result, null, 2)}</pre>
        </div>
      `;
      container.appendChild(div);
    });
  }

  document.getElementById('fullToolsModal').classList.remove('hidden');
}

function closeFullToolsModal() {
  document.getElementById('fullToolsModal').classList.add('hidden');
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

function onSelectModelDropdown(val) {
  const customInput = document.getElementById('cfgModelCustom');
  if (customInput) {
    customInput.value = val;
  }
}

function onInputModelCustom(val) {
  const selectDropdown = document.getElementById('cfgModel');
  if (selectDropdown) {
    // If entered value matches an option in dropdown, select it, else keep current
    const options = Array.from(selectDropdown.options).map(o => o.value);
    if (options.includes(val.trim())) {
      selectDropdown.value = val.trim();
    }
  }
}

async function saveConfig() {
  const key = document.getElementById('cfgApiKey').value.trim();
  const customModel = document.getElementById('cfgModelCustom').value.trim();
  const dropdownModel = document.getElementById('cfgModel').value;
  const model = customModel || dropdownModel || 'gemini-3.5-flash-lite';

  if (key) localStorage.setItem('vucar_gemini_key', key);
  localStorage.setItem('vucar_gemini_model', model);

  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gemini_api_key: key, gemini_model: model })
  });

  document.getElementById('currentModelLabel').innerText = model;
  closeConfigModal();
  alert("Đã lưu cấu hình Gemini thành công: " + model);
}

async function loadConfig() {
  const savedKey = localStorage.getItem('vucar_gemini_key') || '';
  const savedModel = localStorage.getItem('vucar_gemini_model') || 'gemini-3.5-flash-lite';

  document.getElementById('cfgApiKey').value = savedKey;
  
  const selectDropdown = document.getElementById('cfgModel');
  const customInput = document.getElementById('cfgModelCustom');
  
  if (selectDropdown) {
    const options = Array.from(selectDropdown.options).map(o => o.value);
    if (options.includes(savedModel)) {
      selectDropdown.value = savedModel;
    }
  }
  if (customInput) {
    customInput.value = savedModel;
  }

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

// Format message text with markdown images and formatting
function formatChatMessage(text) {
  if (!text) return '';
  // Convert markdown image ![alt](url) to HTML <img>
  let formatted = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(match, alt, url) {
    return `<div class="my-2.5 rounded-xl overflow-hidden border border-slate-200 shadow-sm max-w-sm bg-slate-100">
              <img src="${url}" alt="${alt}" class="w-full h-44 object-cover hover:scale-105 transition-all duration-300" onerror="this.parentElement.style.display='none'"/>
              <div class="px-3 py-1.5 text-[11px] text-slate-600 bg-white font-medium flex items-center justify-between border-t border-slate-100">
                <span class="font-bold text-slate-700"><i class="fa-solid fa-camera mr-1 text-vucar-blue"></i>${alt || 'Hình ảnh thực tế'}</span>
                <span class="text-emerald-600 font-bold text-[10px]"><i class="fa-solid fa-certificate mr-1"></i>Kiểm định 120 điểm</span>
              </div>
            </div>`;
  });
  // Bold **text**
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Newlines to <br>
  formatted = formatted.replace(/\n/g, '<br/>');
  return formatted;
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
