/* =====================================================================
 * TEAMSAATHI - CLIENT-SIDE APPLICATION ENGINE (app.js)
 * Zero-Login Employee Access + Password-Only Admin + Live Voting
 * ===================================================================== */

let DATA = {
  departments: [],
  links: [],
  announcements: [],
  activePoll: null,
  ideas: [],
  bottlenecks: [],
  chat: [],
  teamMembers: [],
  bestIdeas: { deptWinners: [], grandWinner: null }
};

let currentUser = {
  name: '',
  department_id: null,
  department_name: ''
};

let isAdmin = false;
let adminPermissions = ['all'];
let visiblePasswords = {};
let visibleMemberPins = {};

let personalSession = {
  authenticated: false,
  member: null,
  bottlenecks: [],
  ideas: [],
  department_ideas: [],
  selected_idea: null,
  personal_links: []
};
let adminPersonalRoster = [];
let editingMemberCredsId = null;
let editingMemberLinks = [];
let unlockedDeptIds = new Set();

let linkFilterCat = 'all';
let linkFilterDept = 'all';
let ideaFilter = 'all';
let ideaDeptFilter = 'my_dept';
let activeChatTagFilter = null;

// ── BOOTSTRAP INITIALIZATION ──────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadSavedIdentity();
  checkAdminSession();
  loadUnlockedDepts();
  await refreshData();
  initChatPolling();
  checkUrlParamsForPersonalWindow();
});

function loadUnlockedDepts() {
  const saved = sessionStorage.getItem('teamsaathi_unlocked_depts');
  if (saved) {
    try {
      const arr = JSON.parse(saved);
      unlockedDeptIds = new Set(arr.map(n => parseInt(n)));
    } catch (e) {}
  }
  if (personalSession.authenticated && personalSession.member) {
    unlockedDeptIds.add(personalSession.member.department_id);
  }
}

function loadSavedIdentity() {
  const saved = localStorage.getItem('teamsaathi_user');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.name && (parsed.name.toLowerCase().includes('neha') || parsed.name.toLowerCase().includes('guest') || parsed.name.toLowerCase().includes('rahul'))) {
        localStorage.removeItem('teamsaathi_user');
        currentUser = { name: '', department_id: null, department_name: '' };
      } else {
        currentUser = parsed;
      }
    } catch (e) {
      localStorage.removeItem('teamsaathi_user');
    }
  }
  updateIdentityDisplay();
}

function checkAdminSession() {
  const adminSession = sessionStorage.getItem('teamsaathi_admin');
  const permsSession = sessionStorage.getItem('teamsaathi_admin_perms');
  if (adminSession) {
    isAdmin = true;
    try {
      adminPermissions = permsSession ? JSON.parse(permsSession) : ['all'];
    } catch(e) {
      adminPermissions = ['all'];
    }
    updateAdminUiState();
    applyAdminPermissions();
  }
}

async function refreshData() {
  try {
    const deptsParam = Array.from(unlockedDeptIds).join(',');
    const url = `/api/bootstrap?user_name=${encodeURIComponent(currentUser.name || '')}&is_admin=${isAdmin}&unlocked_depts=${encodeURIComponent(deptsParam)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.success) {
      DATA = json;
      renderAll();
    }
  } catch (err) {
    console.error('Failed to load portal data:', err);
    showToast('Could not load live portal data. Please refresh.', 'error');
  }
}

function renderAll() {
  renderStickyTicker();
  renderLinks();
  if (document.getElementById('ideasGrid')) {
    renderIdeas();
  }
  renderLeaderboard();
  renderAnnouncements();
  renderChat();
  populateDropdowns();
  updatePrivateTrackerBadge();

  if (isAdmin) {
    renderAdminTables();
    applyAdminPermissions();
  }
}

function updatePrivateTrackerBadge() {
  const badgeEl = document.getElementById('personalWindowBadge');
  if (badgeEl) {
    if (personalSession.authenticated && personalSession.member) {
      const cnt = personalSession.bottlenecks ? personalSession.bottlenecks.length : 0;
      badgeEl.textContent = cnt;
      badgeEl.style.display = cnt > 0 ? 'inline-block' : 'none';
    } else {
      const userBottlenecks = (DATA.bottlenecks || []).filter(b => currentUser && currentUser.name && b.reported_by && b.reported_by.toLowerCase() === currentUser.name.toLowerCase());
      if (userBottlenecks.length > 0) {
        badgeEl.textContent = userBottlenecks.length;
        badgeEl.style.display = 'inline-block';
      } else {
        badgeEl.style.display = 'none';
      }
    }
  }
}

// ── STICKY TICKER ─────────────────────────────────────────────
function renderStickyTicker() {
  const tickerEl = document.getElementById('stickyAnnouncement');
  const pinned = DATA.announcements.find(a => a.is_pinned === 1) || DATA.announcements[0];

  if (pinned) {
    document.getElementById('tickerBadge').textContent = pinned.priority || 'Notice';
    document.getElementById('tickerText').textContent = pinned.title + ' — ' + pinned.content;
    tickerEl.style.display = 'flex';
  } else {
    tickerEl.style.display = 'none';
  }
}

// ── NAVIGATION TABS ───────────────────────────────────────────
function switchTab(tabId, btnEl) {
  if (tabId === 'ideas') tabId = 'links';
  document.querySelectorAll('.tab-view').forEach(view => view.classList.remove('active'));
  const targetView = document.getElementById('view-' + tabId);
  if (targetView) targetView.classList.add('active');

  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  if (btnEl) {
    btnEl.classList.add('active');
  } else {
    const matchingBtn = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
    if (matchingBtn) matchingBtn.classList.add('active');
  }
}

function switchAdminTab(subTabId, btnEl) {
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.admin-subtab').forEach(b => b.classList.remove('active'));
  const target = document.getElementById(subTabId);
  if (target) target.classList.add('active');
  if (btnEl) btnEl.classList.add('active');
}

// ── 1. LINKS DIRECTORY (COMMON OPEN FOR ALL + DEPT-PIN PROTECTED) ──
function setLinkFilter(btn, type) {
  if (type === 'cat') {
    document.querySelectorAll('#linkCategoryPills .pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    linkFilterCat = btn.dataset.filter;
  } else if (type === 'dept') {
    document.querySelectorAll('#linkDeptPills .pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    linkFilterDept = btn.dataset.filter;
  }
  renderLinks();
}

function promptUnlockDeptLinks(deptId, deptName) {
  const dept = (DATA.departments || []).find(d => d.id === deptId);
  const name = deptName || (dept ? dept.name : 'Department');

  document.getElementById('deptLinkPinDeptId').value = deptId;
  document.getElementById('deptLinkPinModalTitle').textContent = `Unlock ${name} Links`;
  document.getElementById('deptLinkPinModalSub').textContent = `Confidential to ${name}. Enter your 4-digit personal PIN to view.`;
  const pinInput = document.getElementById('deptLinkPinInput');
  pinInput.value = '';
  openModal('deptLinkPinModal');
  setTimeout(() => pinInput.focus(), 150);
}

function toggleDeptLinkPinVisibility() {
  const pinInput = document.getElementById('deptLinkPinInput');
  const eyeBtn = document.getElementById('deptLinkPinEyeBtn');
  if (!pinInput || !eyeBtn) return;
  if (pinInput.type === 'password') {
    pinInput.type = 'text';
    eyeBtn.textContent = '🙈';
  } else {
    pinInput.type = 'password';
    eyeBtn.textContent = '👁️';
  }
}

async function executeDeptLinkUnlock() {
  const deptId = parseInt(document.getElementById('deptLinkPinDeptId').value);
  const pin = document.getElementById('deptLinkPinInput').value.trim();

  if (!pin) {
    showToast('Please enter your 4-digit personal PIN', 'error');
    return;
  }

  try {
    const res = await fetch('/api/links/unlock-dept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department_id: deptId, pin })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showToast(json.error || 'Incorrect PIN for this department', 'error');
      return;
    }

    closeModal('deptLinkPinModal');
    unlockedDeptIds.add(deptId);
    sessionStorage.setItem('teamsaathi_unlocked_depts', JSON.stringify(Array.from(unlockedDeptIds)));
    linkFilterDept = String(deptId);

    // Merge returned links into DATA.links
    if (json.links && json.links.length > 0) {
      json.links.forEach(nl => {
        if (!DATA.links.some(existing => existing.id === nl.id)) {
          DATA.links.push(nl);
        }
      });
    }

    showToast(`🔓 ${json.department_name} links unlocked for ${json.member_name}!`, 'success');
    renderLinks();
  } catch (err) {
    showToast('Network error while unlocking department links', 'error');
  }
}

function renderLinks() {
  const query = (document.getElementById('linkSearchInput').value || '').toLowerCase();
  const grid = document.getElementById('linksGrid');
  if (!grid) return;

  // Render Department pills dynamically
  const deptRow = document.getElementById('linkDeptPills');
  if (deptRow) {
    const commonActive = linkFilterDept === 'all' ? 'active' : '';
    const commonPill = `<button class="pill ${commonActive}" data-filter="all" onclick="setLinkFilter(this, 'dept')">🌐 All Open Links (Common)</button>`;

    const deptPills = (DATA.departments || []).map(d => {
      const isUnlocked = isAdmin || unlockedDeptIds.has(d.id);
      const isSelected = String(linkFilterDept) === String(d.id);
      if (isUnlocked) {
        return `<button class="pill ${isSelected ? 'active' : ''}" data-filter="${d.id}" onclick="setLinkFilter(this, 'dept')">🔓 ${d.icon} ${esc(d.name)}</button>`;
      } else {
        return `<button class="pill" style="opacity: 0.85; border-style: dashed;" onclick="promptUnlockDeptLinks(${d.id}, '${esc(d.name)}')">🔒 ${d.icon} ${esc(d.name)}</button>`;
      }
    }).join('');

    deptRow.innerHTML = commonPill + deptPills;
  }

  let filtered = (DATA.links || []).filter(l => {
    // 1. Category filter
    if (linkFilterCat !== 'all' && l.category !== linkFilterCat) return false;

    // 2. Strict Department Scoping & PIN Protection
    const isCommon = !l.department_id;
    const isDeptUnlocked = l.department_id && (isAdmin || unlockedDeptIds.has(l.department_id));

    if (linkFilterDept === 'all') {
      // Common links are open for all; department links require unlock
      if (!isCommon && !isDeptUnlocked) return false;
    } else {
      if (String(l.department_id) !== String(linkFilterDept)) return false;
      if (!isAdmin && !unlockedDeptIds.has(l.department_id)) return false;
    }

    // 3. Search query
    if (query) {
      const matchTitle = (l.title || '').toLowerCase().includes(query);
      const matchTags = (l.tags || '').toLowerCase().includes(query);
      const matchDept = (l.department_name || '').toLowerCase().includes(query);
      if (!matchTitle && !matchTags && !matchDept) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    const isDeptLocked = linkFilterDept !== 'all' && !isAdmin && !unlockedDeptIds.has(parseInt(linkFilterDept));
    grid.innerHTML = `
      <div class="empty-state">
        <p>${isDeptLocked ? 'This department\'s links are protected and confidential.' : 'No links found matching your criteria.'}</p>
        ${isDeptLocked ? `
          <button class="btn-primary" style="margin-top: 10px;" onclick="promptUnlockDeptLinks(${linkFilterDept})">🔒 Enter PIN to Unlock Department Links</button>
        ` : ''}
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map((l, i) => {
    const tags = (l.tags || '').split(',').filter(t => t.trim()).map(t => `<span class="tag">#${t.trim()}</span>`).join('');
    const isCommon = !l.department_id;
    const deptTag = isCommon
      ? `<span class="badge badge-teal">🌐 Open for All</span>`
      : `<span class="badge badge-lake">🔒 ${esc(l.department_name || 'Department')}</span>`;

    return `
      <a class="card" href="${esc(l.url)}" target="_blank" rel="noopener" style="animation-delay: ${i * 0.03}s">
        <div class="card-top">
          <div class="card-icon">${esc(l.icon || '🔗')}</div>
          ${deptTag}
        </div>
        <h4 class="card-title">${esc(l.title)}</h4>
        <p class="card-sub">${shortUrl(l.url)}</p>
        <div class="card-tags">
          <span class="tag" style="background: rgba(20,184,166,0.1); color: var(--teal-dark);">${esc(l.category)}</span>
          ${tags}
        </div>
      </a>
    `;
  }).join('');
}

// ── 2. IDEA LAB & DEPARTMENT SCOPING ──────────────────────────
function setIdeaFilter(btn) {
  document.querySelectorAll('#ideaFilterPills .pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  ideaFilter = btn.dataset.filter;
  renderIdeas();
}

function setIdeaDeptScope(scopeVal) {
  ideaDeptFilter = scopeVal;
  renderIdeas();
}

function renderIdeas() {
  const query = (document.getElementById('ideaSearchInput').value || '').toLowerCase();
  const grid = document.getElementById('ideasGrid');

  // Active Poll Banner
  const poll = DATA.activePoll;
  if (poll) {
    document.getElementById('pollTitle').textContent = poll.title;
    document.getElementById('pollDesc').textContent = poll.description || 'Vote for ideas that reduce manual workload and increase company revenue.';
    document.getElementById('pollBadge').textContent = poll.is_active ? 'Active Polling Cycle' : 'Voting Locked';
    document.getElementById('pollBadge').className = poll.is_active ? 'badge badge-teal' : 'badge badge-red';
  }
  const totalVotes = DATA.ideas.reduce((acc, cur) => acc + (cur.total_votes || 0), 0);
  document.getElementById('pollVoteTotal').textContent = totalVotes;

  // Render Department Scope Selector Pills
  const scopeRow = document.getElementById('ideaDeptScopePills');
  if (scopeRow) {
    const currentDeptName = currentUser.department_name || 'My Department';
    if (isAdmin) {
      scopeRow.innerHTML = `
        <span style="font-size: 11.5px; font-weight: 700; color: var(--ink-muted); text-transform: uppercase; margin-right: 4px; display: inline-flex; align-items: center;">Scope:</span>
        <button class="pill ${ideaDeptFilter === 'all' ? 'active' : ''}" onclick="setIdeaDeptScope('all')">🌐 All Company Ideas</button>
        <button class="pill ${ideaDeptFilter === 'my_dept' ? 'active' : ''}" onclick="setIdeaDeptScope('my_dept')">🏢 My Dept (${esc(currentDeptName)})</button>
        ${DATA.departments.map(d => `
          <button class="pill ${String(ideaDeptFilter) === String(d.id) ? 'active' : ''}" onclick="setIdeaDeptScope('${d.id}')">${d.icon || '🏢'} ${esc(d.code)}</button>
        `).join('')}
      `;
    } else {
      scopeRow.innerHTML = `
        <span style="font-size: 11.5px; font-weight: 700; color: var(--ink-muted); text-transform: uppercase; margin-right: 4px; display: inline-flex; align-items: center;">Scope:</span>
        <button class="pill active" style="cursor: default;" title="Strict Department Isolation Active">🔒 My Dept (${esc(currentDeptName)})</button>
      `;
    }
  }

  let filtered = DATA.ideas.filter(idea => {
    // 1. Department Scope Filter (Enforce strict isolation for regular members)
    if (!isAdmin) {
      if (String(idea.department_id) !== String(currentUser.department_id)) return false;
    } else {
      if (ideaDeptFilter === 'my_dept') {
        if (String(idea.department_id) !== String(currentUser.department_id)) return false;
      } else if (ideaDeptFilter !== 'all') {
        if (String(idea.department_id) !== String(ideaDeptFilter)) return false;
      }
    }

    // 2. Category / Winner Filter
    if (ideaFilter === 'winners' && idea.status !== 'Best Idea') return false;
    if (ideaFilter === 'selected' && !idea.is_selected && idea.status !== 'Selected') return false;
    if (ideaFilter !== 'all' && ideaFilter !== 'winners' && ideaFilter !== 'selected' && idea.category !== ideaFilter) return false;

    // 3. Search query
    if (query) {
      const matchTitle = idea.title.toLowerCase().includes(query);
      const matchDesc = (idea.description || '').toLowerCase().includes(query);
      const matchDept = (idea.department_name || '').toLowerCase().includes(query);
      const matchSub = (idea.submitter_name || '').toLowerCase().includes(query);
      const matchTags = (idea.tags || '').toLowerCase().includes(query);
      if (!matchTitle && !matchDesc && !matchDept && !matchSub && !matchTags) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <p>No ideas found for this department or filter.</p>
        <button class="btn-primary" style="margin-top: 10px;" onclick="openSubmitIdeaModal()">+ Submit an Idea for ${esc(currentUser.department_name)}</button>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map((idea, i) => {
    const isWinner = idea.status === 'Best Idea';
    const isSelected = idea.is_selected === 1 || idea.status === 'Selected';
    const isLocked = idea.is_locked === 1;
    const isPendingApproval = idea.poll_allowed === 0;
    const isAuthor = currentUser.name && idea.submitter_name && currentUser.name.toLowerCase().trim() === idea.submitter_name.toLowerCase().trim();

    const crown = isWinner ? `<div class="crown-badge">🏆 Department Best Choice • ${esc(idea.department_name)}</div>` : '';
    const selectedBadge = isSelected ? `<span class="badge-selected-idea">🎯 Selected for Implementation</span>` : '';
    const pendingBadge = isPendingApproval ? `<span class="badge" style="background: #FEF3C7; color: #92400E; font-weight: 700;">⏳ Pending Admin Approval</span>` : '';
    const lockedBadge = (isLocked && !isPendingApproval && !isSelected) ? `<span class="badge-locked-idea">🔒 Voting Closed</span>` : '';

    const tags = (idea.tags || '').split(',').filter(t => t.trim()).map(t => `<span class="tag">#${t.trim()}</span>`).join('');
    const bottleneckBadge = idea.bottleneck_title
      ? `<div style="font-size: 11.5px; color: var(--teal-dark); background: rgba(20,184,166,0.08); padding: 5px 8px; border-radius: 5px; margin-bottom: 8px;">
           ⚡ <b>Solves:</b> ${esc(idea.bottleneck_title)}
         </div>`
      : '';

    // Action buttons bar
    let actionButtons = '';
    if (isAuthor || isAdmin) {
      actionButtons += `<button class="card-action-btn" onclick="openEditIdeaModal(${idea.id})">✏️ Edit</button>`;
      actionButtons += `<button class="card-action-btn btn-delete-idea" onclick="deleteIdea(${idea.id})">🗑️ Delete</button>`;
    }
    if (isAdmin) {
      if (isPendingApproval) {
        actionButtons += `<button class="card-action-btn" style="color: var(--teal); border-color: var(--teal); font-weight: 700;" onclick="allowIdeaPoll(${idea.id})">▶️ Allow Poll & Start Voting</button>`;
      } else {
        actionButtons += `<button class="card-action-btn" onclick="toggleIdeaLock(${idea.id})">${isLocked ? '🔓 Reopen' : '🔒 Lock'}</button>`;
      }
      actionButtons += `<button class="card-action-btn btn-select-idea" onclick="toggleIdeaSelect(${idea.id})">${isSelected ? '✓ Unselect' : '🎯 Select'}</button>`;
    }
    if (isSelected || isWinner) {
      actionButtons += `<button class="card-action-btn" style="color: #D97706; border-color: #FCD34D;" onclick="openCelebrationForIdea(${idea.id})">🎉 Celebrate</button>`;
    }

    let voteButton = '';
    if (isPendingApproval) {
      voteButton = `<button class="vote-btn" disabled style="opacity: 0.6; cursor: not-allowed; background: #E2E8F0; color: var(--ink-muted); font-size: 12px;">⏳ Awaiting Admin Approval</button>`;
    } else if (isLocked) {
      voteButton = `<button class="vote-btn" disabled style="opacity: 0.6; cursor: not-allowed; background: #E2E8F0; color: var(--ink-muted); font-size: 12px;">🔒 Locked</button>`;
    } else {
      voteButton = `<button class="vote-btn" onclick="castVote(${idea.id})">▲ Upvote</button>`;
    }

    return `
      <div class="card idea-card" style="border-color: ${isSelected ? '#F59E0B' : (isWinner ? '#FBBF24' : 'var(--border)')}; animation-delay: ${i * 0.03}s">
        ${crown}
        <div class="card-top" style="margin-bottom: 6px; flex-wrap: wrap; gap: 6px;">
          <span class="badge badge-lake">${esc(idea.category)}</span>
          ${selectedBadge}
          ${pendingBadge}
          ${lockedBadge}
          <span style="font-size: 12px; color: var(--ink-muted); margin-left: auto;">By <b>${esc(idea.submitter_name)}</b> • ${esc(idea.department_name)}</span>
        </div>
        <h4 class="card-title">${esc(idea.title)}</h4>
        <p class="card-sub">${esc(idea.description)}</p>
        ${idea.expected_impact ? `<p style="font-size: 12px; color: #B45309; margin-bottom: 6px;"><b>Expected Impact:</b> ${esc(idea.expected_impact)}</p>` : ''}
        ${bottleneckBadge}
        <div class="card-tags" style="margin-bottom: 8px;">
          ${tags}
        </div>
        <div class="idea-vote-row">
          <div>
            <b style="font-size: 18px; color: var(--ink);">${idea.total_votes || 0}</b>
            <span style="font-size: 12px; color: var(--ink-muted);">upvotes (${idea.dept_votes || 0} in ${esc(idea.department_name)})</span>
          </div>
          ${voteButton}
        </div>
        ${actionButtons ? `<div class="card-action-bar">${actionButtons}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function castVote(ideaId) {
  if (!currentUser.name || !currentUser.department_id) {
    openIdentityModal();
    return;
  }

  try {
    const res = await fetch(`/api/ideas/${ideaId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voter_name: currentUser.name,
        voter_department_id: currentUser.department_id
      })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showToast(json.error || 'Vote failed', 'error');
      return;
    }
    showToast(json.message || 'Vote recorded!', 'success');
    await refreshData();
  } catch (err) {
    showToast('Network error while recording vote.', 'error');
  }
}

// ── 3. BEST IDEAS LEADERBOARD & PODIUM ────────────────────────
function renderLeaderboard() {
  const podium = document.getElementById('podiumContainer');
  const deptGrid = document.getElementById('deptChampionsGrid');
  const sorted = [...DATA.ideas].sort((a, b) => (b.total_votes || 0) - (a.total_votes || 0));

  if (sorted.length === 0) {
    podium.innerHTML = `<div class="empty-state"><p>No votes cast yet in this innovation cycle.</p></div>`;
    deptGrid.innerHTML = '';
    return;
  }

  const first = sorted[0];
  const second = sorted[1] || null;
  const third = sorted[2] || null;

  podium.innerHTML = `
    <!-- 2ND PLACE -->
    ${second ? `
      <div class="podium-card">
        <div class="podium-rank-badge rank-silver">2</div>
        <span class="badge badge-teal">${esc(second.department_name)}</span>
        <h4 style="margin: 10px 0 6px; font-size: 16px;">${esc(second.title)}</h4>
        <p style="font-size: 13px; color: var(--ink-muted);">${second.total_votes} Total Votes (${second.dept_votes} Dept Votes)</p>
      </div>
    ` : '<div class="podium-card" style="opacity: 0.5;"><p style="font-size: 13px; color: var(--ink-muted);">Awaiting 2nd Place</p></div>'}

    <!-- 1ST PLACE (GRAND CHAMPION) -->
    <div class="podium-card podium-1st">
      <div class="podium-rank-badge rank-gold">1</div>
      <span class="badge badge-gold">🌟 Grand Company Champion</span>
      <h3 style="font-family: var(--font-head); font-size: 22px; margin: 10px 0 6px;">${esc(first.title)}</h3>
      <p style="font-size: 13px; color: var(--ink-muted);">${esc(first.department_name)} • Submitted by ${esc(first.submitter_name)}</p>
      <div style="font-size: 16px; font-weight: 700; color: var(--lake); margin: 8px 0;">${first.total_votes} Total Upvotes</div>
      <div style="font-size: 12px; font-weight: 700; color: var(--gold);">✓ Selected for Automation Build</div>
    </div>

    <!-- 3RD PLACE -->
    ${third ? `
      <div class="podium-card">
        <div class="podium-rank-badge rank-bronze">3</div>
        <span class="badge badge-lake">${esc(third.department_name)}</span>
        <h4 style="margin: 10px 0 6px; font-size: 16px;">${esc(third.title)}</h4>
        <p style="font-size: 13px; color: var(--ink-muted);">${third.total_votes} Total Votes (${third.dept_votes} Dept Votes)</p>
      </div>
    ` : '<div class="podium-card" style="opacity: 0.5;"><p style="font-size: 13px; color: var(--ink-muted);">Awaiting 3rd Place</p></div>'}
  `;

  // Department Winners
  const winners = DATA.bestIdeas.deptWinners || [];
  if (winners.length === 0) {
    deptGrid.innerHTML = `<div class="empty-state"><p>Department champions will appear as soon as votes are cast.</p></div>`;
    return;
  }

  deptGrid.innerHTML = winners.map(w => `
    <div class="card" style="border-left: 4px solid #F59E0B;">
      <div class="card-top">
        <span class="crown-badge">🏆 ${esc(w.department_name)} Best Choice</span>
        <span class="badge badge-lake">${w.dept_votes} Dept Votes</span>
      </div>
      <h4 class="card-title">${esc(w.title)}</h4>
      <p class="card-sub">${esc(w.description)}</p>
      <div style="font-size: 12px; color: var(--ink-muted);">
        Proposed by <b>${esc(w.submitter_name)}</b> • ${w.total_votes} total company votes
      </div>
    </div>
  `).join('');
}

// ── 4. BOTTLENECKS & HURDLES TRACKER ─────────────────────────
function setBottleneckFilter(btn) {
  document.querySelectorAll('#bottleneckSeverityPills .pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  bottleneckFilter = btn.dataset.filter;
  renderBottlenecks();
}

function renderBottlenecks() {
  const query = (document.getElementById('bottleneckSearchInput').value || '').toLowerCase();
  const grid = document.getElementById('bottlenecksGrid');

  let filtered = DATA.bottlenecks.filter(b => {
    if (bottleneckFilter === 'Open' && b.status !== 'Open') return false;
    if (bottleneckFilter !== 'all' && bottleneckFilter !== 'Open' && b.severity !== bottleneckFilter) return false;
    if (query) {
      const matchTitle = b.title.toLowerCase().includes(query);
      const matchDetails = (b.details || '').toLowerCase().includes(query);
      const matchDept = (b.department_name || '').toLowerCase().includes(query);
      const matchTags = (b.tags || '').toLowerCase().includes(query);
      if (!matchTitle && !matchDetails && !matchDept && !matchTags) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>No bottlenecks found matching criteria.</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map((b, i) => {
    const sevBadge = b.severity === 'Critical'
      ? `<span class="badge badge-red">Critical Blocker</span>`
      : `<span class="badge badge-gold">${esc(b.severity)} Friction</span>`;
    const hours = b.hours_lost_week ? `⚠️ ${b.hours_lost_week} hrs lost / wk` : '';
    const tags = (b.tags || '').split(',').filter(t => t.trim()).map(t => `<span class="tag">#${t.trim()}</span>`).join('');

    const action = b.status === 'Solution Linked'
      ? `<span style="font-size: 12px; color: var(--teal-dark); font-weight: 600;">✓ Solution Proposed</span>`
      : `<button class="btn-pitch-solution" onclick="proposeIdeaForBottleneck(${b.id}, '${esc(b.title)}')">💡 Pitch Solution</button>`;

    const solutionsHtml = (b.solution_1 || b.solution_2 || b.solution_3) ? `
      <div style="background: var(--snow); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin: 12px 0;">
        <div style="font-size: 11px; font-weight: 700; color: var(--lake); text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
          <span>💡</span> 3 Proposed Solutions:
        </div>
        ${b.solution_1 ? `<div style="font-size: 12px; margin-bottom: 6px; color: var(--ink); line-height: 1.4;"><b>1. Quick Fix:</b> ${esc(b.solution_1)}</div>` : ''}
        ${b.solution_2 ? `<div style="font-size: 12px; margin-bottom: 6px; color: var(--ink); line-height: 1.4;"><b>2. Automation:</b> ${esc(b.solution_2)}</div>` : ''}
        ${b.solution_3 ? `<div style="font-size: 12px; color: var(--ink); line-height: 1.4;"><b>3. Process Change:</b> ${esc(b.solution_3)}</div>` : ''}
      </div>
    ` : '';

    return `
      <div class="card bottleneck-card" style="border-left-color: ${b.severity === 'Critical' ? 'var(--red)' : 'var(--gold)'}; animation-delay: ${i * 0.03}s">
        <div class="card-top">
          ${sevBadge}
          <span style="font-size: 12px; font-weight: 600; color: var(--red);">${hours}</span>
        </div>
        <div style="font-size: 11.5px; color: var(--ink-muted); font-weight: 600; text-transform: uppercase;">
          ${esc(b.department_name)} • Reported by ${esc(b.reported_by)}
        </div>
        <h4 class="card-title" style="margin-top: 4px;">${esc(b.title)}</h4>
        <p class="card-sub">${esc(b.details)}</p>
        ${solutionsHtml}
        <div class="card-tags" style="margin-bottom: 12px;">${tags}</div>
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 10px;">
          <span style="font-size: 12px; color: var(--ink-muted);">Status: <b>${esc(b.status)}</b></span>
          ${action}
        </div>
      </div>
    `;
  }).join('');
}

function proposeIdeaForBottleneck(bottleneckId, title) {
  openSubmitIdeaModal();
  document.getElementById('ideaModalBottleneckSelect').value = bottleneckId;
  document.getElementById('ideaModalTitleInput').value = `Automated Solution for: ${title}`;
}

// ── 4. COMPANY UPDATES (ANNOUNCEMENTS) ─────────────────────────
function renderAnnouncements() {
  const list = document.getElementById('announcementsList');
  if (!list) return;
  if (DATA.announcements.length === 0) {
    list.innerHTML = `<div class="empty-state"><p>No company updates published yet.</p></div>`;
    return;
  }

  list.innerHTML = DATA.announcements.map((a, i) => {
    let priorityBadge = 'badge-lake';
    if (a.priority === 'Urgent') priorityBadge = 'badge-red';
    if (a.priority === 'Milestone') priorityBadge = 'badge-gold';

    const celebrateBtn = a.priority === 'Milestone'
      ? `<button class="card-action-btn" style="margin-left: 8px; color: #D97706; border-color: #FCD34D;" onclick="triggerCelebration('${esc(a.title)}', 'Teamsaathi Executive', 'Company Milestone', 'MILESTONE CELEBRATION')">🎉 Celebrate</button>`
      : '';

    const adminActions = isAdmin
      ? `<div style="display: inline-flex; gap: 4px; margin-left: 8px;">
           <button class="card-action-btn" onclick="openEditAnnouncementModal(${a.id})">✏️ Edit</button>
           <button class="card-action-btn" style="color: var(--crimson); border-color: #FECACA;" onclick="deleteAnnouncement(${a.id})">🗑️ Delete</button>
         </div>`
      : '';

    return `
      <div class="announcement-item ${a.priority === 'Urgent' ? 'urgent' : ''}" style="animation-delay: ${i * 0.04}s">
        <div class="announcement-header">
          <div class="announcement-title">
            ${a.is_pinned ? '📌 ' : ''}${esc(a.title)}
          </div>
          <div class="announcement-meta">
            <span class="badge ${priorityBadge}">${esc(a.priority)}</span>
            ${a.department_name ? `<span class="badge badge-lake">${esc(a.department_name)}</span>` : '<span class="badge badge-teal">Company-Wide</span>'}
            <span>${formatDate(a.created_at)}</span>
            ${celebrateBtn}
            ${adminActions}
          </div>
        </div>
        <div class="announcement-body">${esc(a.content)}</div>
      </div>
    `;
  }).join('');
}

// ── 5. TEAM CHAT & INTERACTIVE HASHTAGS ───────────────────────
function filterChatByTag(tag) {
  activeChatTagFilter = tag.startsWith('#') ? tag : '#' + tag;
  const banner = document.getElementById('chatFilterBanner');
  const label = document.getElementById('activeChatTag');
  if (banner && label) {
    label.textContent = activeChatTagFilter;
    banner.style.display = 'flex';
  }
  renderChat();
}

function clearChatTagFilter() {
  activeChatTagFilter = null;
  const banner = document.getElementById('chatFilterBanner');
  if (banner) banner.style.display = 'none';
  renderChat();
}

function insertChatTag(tag) {
  const input = document.getElementById('chatInputMessage');
  if (input) {
    input.value = (input.value ? input.value + ' ' : '') + tag + ' ';
    input.focus();
  }
}

// ── CHAT @MENTIONS AUTOCOMPLETE & HIGHLIGHTS ──────────────────
let chatMentionActiveIndex = 0;
let chatMentionList = [];

function renderChatQuickMentions() {
  const container = document.getElementById('chatQuickMentions');
  if (!container) return;
  const members = (DATA.teamMembers || []).slice(0, 8);
  if (members.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = members.map(m => {
    const firstWord = (m.name || '').split(' ')[0];
    return `<button type="button" class="quick-mention-chip" onclick="insertQuickMention('${esc(m.name)}')">@${esc(firstWord)}</button>`;
  }).join('');
}

function insertQuickMention(name) {
  const input = document.getElementById('chatInputMessage');
  if (!input) return;
  const current = input.value;
  const mentionText = `@${name} `;
  if (!current.includes(mentionText)) {
    input.value = current ? current.trimEnd() + ' ' + mentionText : mentionText;
  }
  input.focus();
}

function handleChatInput(e) {
  const input = e.target;
  const val = input.value;
  const cursor = input.selectionStart;
  const textBeforeCursor = val.slice(0, cursor);

  const match = textBeforeCursor.match(/@([a-zA-Z0-9_\s]{0,20})$/);
  const dropdown = document.getElementById('chatMentionDropdown');
  if (!dropdown) return;

  if (!match) {
    dropdown.style.display = 'none';
    chatMentionList = [];
    return;
  }

  const query = match[1].toLowerCase().trim();
  chatMentionList = (DATA.teamMembers || []).filter(m => {
    if (!query) return true;
    return (m.name && m.name.toLowerCase().includes(query)) || (m.role_title && m.role_title.toLowerCase().includes(query));
  }).slice(0, 6);

  if (chatMentionList.length === 0) {
    dropdown.style.display = 'none';
    return;
  }

  chatMentionActiveIndex = 0;
  renderChatMentionDropdown();
  dropdown.style.display = 'block';
}

function renderChatMentionDropdown() {
  const dropdown = document.getElementById('chatMentionDropdown');
  if (!dropdown) return;
  dropdown.innerHTML = chatMentionList.map((m, idx) => `
    <div class="chat-mention-item ${idx === chatMentionActiveIndex ? 'selected' : ''}" onclick="selectChatMention('${esc(m.name)}')">
      <div class="chat-mention-avatar" style="background: ${m.department_color || '#2A6FA8'};">
        ${(m.name || 'U').substring(0, 2).toUpperCase()}
      </div>
      <div>
        <div class="chat-mention-name">${esc(m.name)}</div>
        <div class="chat-mention-dept">${esc(m.department_name || '')} • ${esc(m.role_title || '')}</div>
      </div>
    </div>
  `).join('');
}

function handleChatKeyDown(e) {
  const dropdown = document.getElementById('chatMentionDropdown');
  if (!dropdown || dropdown.style.display === 'none' || chatMentionList.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    chatMentionActiveIndex = (chatMentionActiveIndex + 1) % chatMentionList.length;
    renderChatMentionDropdown();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    chatMentionActiveIndex = (chatMentionActiveIndex - 1 + chatMentionList.length) % chatMentionList.length;
    renderChatMentionDropdown();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (chatMentionList[chatMentionActiveIndex]) {
      e.preventDefault();
      selectChatMention(chatMentionList[chatMentionActiveIndex].name);
    }
  } else if (e.key === 'Escape') {
    dropdown.style.display = 'none';
  }
}

function selectChatMention(name) {
  const input = document.getElementById('chatInputMessage');
  const dropdown = document.getElementById('chatMentionDropdown');
  if (!input) return;

  const cursor = input.selectionStart;
  const textBefore = input.value.slice(0, cursor);
  const textAfter = input.value.slice(cursor);

  const replacedBefore = textBefore.replace(/@([a-zA-Z0-9_\s]{0,20})$/, `@${name} `);
  input.value = replacedBefore + textAfter;
  if (dropdown) dropdown.style.display = 'none';
  input.focus();
  const newCursor = replacedBefore.length;
  input.setSelectionRange(newCursor, newCursor);
}

function renderChat() {
  const stream = document.getElementById('chatStream');
  if (!stream) return;
  renderChatQuickMentions();
  if (DATA.chat.length === 0) {
    stream.innerHTML = `<div class="empty-state"><p>No messages yet. Say hello to the team!</p></div>`;
    return;
  }

  let messages = DATA.chat;
  if (activeChatTagFilter) {
    const filterLower = activeChatTagFilter.toLowerCase();
    messages = messages.filter(m => (m.message && m.message.toLowerCase().includes(filterLower)) || (m.tags && m.tags.toLowerCase().includes(filterLower)));
  }

  if (messages.length === 0) {
    stream.innerHTML = `<div class="empty-state"><p>No messages matching <b>${esc(activeChatTagFilter)}</b>. <button onclick="clearChatTagFilter()" style="border:none;background:none;color:var(--lake);cursor:pointer;font-weight:600;">Clear filter</button></p></div>`;
    return;
  }

  stream.innerHTML = messages.map(msg => {
    // Format hashtags as clickable pills
    let formattedText = esc(msg.message).replace(/(#[a-zA-Z0-9_]+)/g, '<span class="chat-tag" onclick="filterChatByTag(\'$1\')">$1</span>');

    // Format @mentions with visual highlights
    (DATA.teamMembers || []).forEach(tm => {
      const isMe = currentUser.name && currentUser.name.toLowerCase() === tm.name.toLowerCase();
      const mentionCls = isMe ? 'chat-mention mention-me' : 'chat-mention';
      const safeName = esc(tm.name);
      const reFullName = new RegExp(`@${safeName}\\b`, 'gi');
      formattedText = formattedText.replace(reFullName, `<span class="${mentionCls}">@${safeName}</span>`);

      const firstName = (tm.name || '').split(' ')[0];
      if (firstName && firstName.length > 2 && firstName !== tm.name) {
        const safeFirst = esc(firstName);
        const reFirst = new RegExp(`@${safeFirst}\\b`, 'gi');
        formattedText = formattedText.replace(reFirst, `<span class="${mentionCls}">@${safeFirst}</span>`);
      }
    });

    return `
      <div class="chat-item">
        <div class="user-avatar" style="background: ${msg.department_color || 'var(--lake)'}; flex-shrink: 0;">
          ${(msg.sender_name || 'U').substring(0, 2).toUpperCase()}
        </div>
        <div class="chat-bubble">
          <div class="chat-meta">
            <span>${esc(msg.sender_name)}</span>
            <span class="badge badge-lake" style="font-size: 9.5px; padding: 1px 6px;">${esc(msg.department_name)}</span>
            <span style="font-size: 10.5px; color: var(--ink-muted); font-weight: normal; margin-left: auto;">${formatTime(msg.created_at)}</span>
          </div>
          <div class="chat-text">${formattedText}</div>
        </div>
      </div>
    `;
  }).join('');

  stream.scrollTop = stream.scrollHeight;
}

async function sendChatMessage(e) {
  e.preventDefault();
  const input = document.getElementById('chatInputMessage');
  const message = input.value.trim();
  if (!message) return;

  let senderName = (personalSession.authenticated && personalSession.member) 
    ? personalSession.member.name 
    : (currentUser && currentUser.name ? currentUser.name : '');
  let senderDeptId = (personalSession.authenticated && personalSession.member) 
    ? personalSession.member.department_id 
    : (currentUser && currentUser.department_id ? currentUser.department_id : null);

  if (!senderName || !senderDeptId) {
    openPersonalLoginModal();
    showToast('Please log into your Personal Window with your PIN to participate in Team Chat', 'info');
    return;
  }

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_name: senderName,
        sender_department_id: senderDeptId,
        message
      })
    });
    const json = await res.json();
    if (json.success) {
      input.value = '';
      DATA.chat.push(json.message);
      renderChat();
    } else {
      showToast(json.error || 'Failed to send message', 'error');
    }
  } catch (err) {
    showToast('Failed to send message: ' + err.message, 'error');
  }
}

function initChatPolling() {
  // Fast chat refresh every 10 seconds
  setInterval(async () => {
    try {
      const res = await fetch('/api/bootstrap');
      const json = await res.json();
      if (json.success) {
        DATA.chat = json.chat;
        renderChat();
      }
    } catch (e) {}
  }, 10000);
}

// ── 7. ZERO-LOGIN IDENTITY SELECTION ──────────────────────────
function openIdentityModal() {
  const select = document.getElementById('identityMemberSelect');
  select.innerHTML = `<option value="">-- Choose From Directory --</option>` +
    DATA.teamMembers.map(m => `
      <option value="${m.id}" data-name="${esc(m.name)}" data-dept="${m.department_id}" data-deptname="${esc(m.department_name)}">
        ${esc(m.name)} — ${esc(m.department_name)} (${esc(m.role_title)})
      </option>
    `).join('');

  const deptSelect = document.getElementById('identityCustomDept');
  deptSelect.innerHTML = DATA.departments.map(d => `<option value="${d.id}">${d.icon} ${esc(d.name)}</option>`).join('');

  document.getElementById('identityCustomName').value = currentUser.name;
  document.getElementById('identityCustomDept').value = currentUser.department_id;
  openModal('identityModal');
}

function handleIdentitySelectChange() {
  const select = document.getElementById('identityMemberSelect');
  const opt = select.options[select.selectedIndex];
  if (opt && opt.value) {
    document.getElementById('identityCustomName').value = opt.dataset.name;
    document.getElementById('identityCustomDept').value = opt.dataset.dept;
  }
}

function saveUserIdentity() {
  const name = document.getElementById('identityCustomName').value.trim();
  const deptId = parseInt(document.getElementById('identityCustomDept').value);
  if (!name || !deptId) {
    showToast('Please provide your name and department.', 'error');
    return;
  }

  const dept = DATA.departments.find(d => d.id === deptId);
  currentUser = {
    name,
    department_id: deptId,
    department_name: dept ? dept.name : 'General'
  };

  localStorage.setItem('teamsaathi_user', JSON.stringify(currentUser));
  updateIdentityDisplay();
  closeModal('identityModal');
  showToast(`Identity switched to ${name}!`, 'success');
}

function updateIdentityDisplay() {
  const nameEl = document.getElementById('currentUserName');
  const deptEl = document.getElementById('currentUserDept');
  const avatarEl = document.getElementById('currentAvatar');
  if (nameEl) nameEl.textContent = currentUser.name || 'Guest Employee';
  if (deptEl) deptEl.textContent = currentUser.department_name || '';
  if (avatarEl) {
    const initials = currentUser.name ? currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '👤';
    avatarEl.textContent = initials;
  }

  // Update Personal Window button text dynamically
  const pwBtn = document.getElementById('personalWindowBtn');
  if (pwBtn) {
    if (personalSession && personalSession.authenticated && personalSession.member) {
      pwBtn.innerHTML = `<span>👤</span> ${esc(personalSession.member.name)} <span class="badge-count" id="personalWindowBadge" style="display: none;">0</span>`;
      pwBtn.title = `Logged in as ${personalSession.member.name} (${personalSession.member.department_name}). Click to open your Personal Window.`;
      pwBtn.style.borderColor = 'var(--lake)';
    } else {
      pwBtn.innerHTML = `<span>👤</span> Personal Window <span class="badge-count" id="personalWindowBadge" style="display: none;">0</span>`;
      pwBtn.title = 'Access your confidential personal window, bottlenecks, and private documents';
      pwBtn.style.borderColor = '';
    }
  }
}

// ── 8. ADMIN LOGIN & AUTH (PASSWORD ONLY - NO EMAIL) ──────────
function handleAdminButtonClick() {
  if (isAdmin) {
    switchTab('admin');
  } else {
    document.getElementById('adminLoginPasswordInput').value = '';
    openModal('adminLoginModal');
    document.getElementById('adminLoginPasswordInput').focus();
  }
}

async function executeAdminLogin() {
  const password = document.getElementById('adminLoginPasswordInput').value;
  if (!password) {
    showToast('Please enter admin password', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showToast(json.error || 'Incorrect admin password', 'error');
      return;
    }

    isAdmin = true;
    adminPermissions = json.permissions || ['all'];
    sessionStorage.setItem('teamsaathi_admin', 'true');
    sessionStorage.setItem('teamsaathi_admin_perms', JSON.stringify(adminPermissions));
    closeModal('adminLoginModal');
    updateAdminUiState();
    showToast(`Signed in as Admin (${json.adminName || 'Admin'})!`, 'success');
    switchTab('admin');
    await refreshData();
    applyAdminPermissions();
  } catch (err) {
    showToast('Network error while signing in', 'error');
  }
}

function adminLogout() {
  isAdmin = false;
  adminPermissions = ['all'];
  sessionStorage.removeItem('teamsaathi_admin');
  sessionStorage.removeItem('teamsaathi_admin_perms');
  updateAdminUiState();
  switchTab('links');
  showToast('Signed out of Admin console', 'success');
  refreshData();
}

function updateAdminUiState() {
  const adminBtn = document.getElementById('adminButton');
  const adminBtnText = document.getElementById('adminBtnText');
  const linkActions = document.getElementById('adminLinkActions');
  const pollControls = document.getElementById('adminPollControls');
  const announceActions = document.getElementById('adminAnnounceActions');

  if (isAdmin) {
    adminBtn.classList.add('logged-in');
    adminBtnText.textContent = 'Admin Console';
    if (linkActions) linkActions.style.display = 'block';
    if (pollControls) pollControls.style.display = 'block';
    if (announceActions) announceActions.style.display = 'block';
  } else {
    adminBtn.classList.remove('logged-in');
    adminBtnText.textContent = 'Admin Area';
    if (linkActions) linkActions.style.display = 'none';
    if (pollControls) pollControls.style.display = 'none';
    if (announceActions) announceActions.style.display = 'none';
  }
}

function applyAdminPermissions() {
  if (!isAdmin) return;
  const isSuper = adminPermissions.includes('all');
  const subtabs = document.querySelectorAll('.admin-subtab');
  const contents = document.querySelectorAll('.admin-tab-content');

  let firstVisibleSubtab = null;
  let firstVisibleContentId = null;

  subtabs.forEach(btn => {
    const mod = btn.dataset.module;
    const allowed = isSuper || adminPermissions.includes(mod);
    btn.style.display = allowed ? '' : 'none';
    if (allowed && !firstVisibleSubtab) {
      firstVisibleSubtab = btn;
    }
  });

  contents.forEach(cnt => {
    const mod = cnt.dataset.module;
    const allowed = isSuper || adminPermissions.includes(mod);
    if (!allowed) {
      cnt.classList.remove('active');
    } else if (!firstVisibleContentId) {
      firstVisibleContentId = cnt.id;
    }
  });

  const currentActiveBtn = document.querySelector('.admin-subtab.active');
  if (currentActiveBtn && currentActiveBtn.style.display === 'none') {
    if (firstVisibleSubtab && firstVisibleContentId) {
      switchAdminTab(firstVisibleContentId, firstVisibleSubtab);
    }
  }
}

// ── 9. ADMIN CONSOLE OPERATIONS ───────────────────────────────
async function renderAdminTables() {
  // 1. Links table
  const linksTbody = document.getElementById('adminLinksTableBody');
  if (linksTbody) {
    linksTbody.innerHTML = DATA.links.map(l => `
      <tr>
        <td>${esc(l.icon || '🔗')}</td>
        <td><b>${esc(l.title)}</b></td>
        <td><span class="badge badge-lake">${esc(l.category)}</span></td>
        <td>${esc(l.department_name || 'Company-Wide')}</td>
        <td><a href="${esc(l.url)}" target="_blank" style="color: var(--lake); font-size: 12.5px;">${shortUrl(l.url)}</a></td>
        <td><span style="font-size: 11.5px; color: var(--ink-muted);">${esc(l.tags || '-')}</span></td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn-icon-action" onclick="openEditLinkModal(${l.id})">✏️ Edit</button>
          <button class="btn-icon-action delete" onclick="deleteLink(${l.id})">🗑️ Delete</button>
        </td>
      </tr>
    `).join('');
  }

  // 2. Company Updates / Announcements table
  const announceTbody = document.getElementById('adminAnnounceTableBody');
  if (announceTbody) {
    announceTbody.innerHTML = DATA.announcements.map(a => `
      <tr>
        <td><span class="badge ${a.priority === 'Urgent' ? 'badge-red' : (a.priority === 'Milestone' ? 'badge-gold' : 'badge-lake')}">${esc(a.priority)}</span></td>
        <td><b>${esc(a.title)}</b><div style="font-size: 12px; color: var(--ink-muted); margin-top: 2px;">${esc(a.content)}</div></td>
        <td>${esc(a.department_name || 'Company-Wide')}</td>
        <td>${a.is_pinned ? '📌 Pinned' : '-'}</td>
        <td style="color: var(--ink-muted); font-size: 12px;">${formatDate(a.created_at)}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn-icon-action" onclick="openEditAnnouncementModal(${a.id})" style="margin-right: 4px;">✏️ Edit</button>
          <button class="btn-icon-action delete" onclick="deleteAnnouncement(${a.id})">🗑️ Delete</button>
        </td>
      </tr>
    `).join('');
  }

  // 3. Confidential Bottlenecks Review table
  renderAdminBottlenecks();

  // 4. Poll Controller & Pending Idea Approvals
  const pollCard = document.getElementById('adminPollCard');
  const poll = DATA.activePoll;
  if (pollCard) {
    const pendingIdeas = (DATA.ideas || []).filter(i => i.poll_allowed === 0);
    const pendingHtml = pendingIdeas.length > 0 ? `
      <div style="background: #FEF3C7; border: 1px solid #FCD34D; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <div style="font-weight: 700; color: #92400E; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
            <span>🔔</span> ${pendingIdeas.length} Submitted Idea(s) Awaiting Admin Poll Approval
          </div>
          <span class="badge" style="background: #F59E0B; color: white; font-size: 11px;">PENDING APPROVAL</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${pendingIdeas.map(pi => `
            <div style="background: white; border: 1px solid #FDE68A; border-radius: 6px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div>
                <div style="font-weight: 600; font-size: 13px; color: var(--ink);">${esc(pi.title)}</div>
                <div style="font-size: 11.5px; color: var(--ink-muted);">By <b>${esc(pi.submitter_name)}</b> • ${esc(pi.department_name)} (${esc(pi.category)})</div>
              </div>
              <button class="btn-primary" style="font-size: 12px; padding: 5px 12px; background: var(--teal);" onclick="allowIdeaPoll(${pi.id})">
                ▶️ Allow Poll & Start Voting
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    if (poll) {
      pollCard.innerHTML = `
        ${pendingHtml}
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span class="badge ${poll.is_active ? 'badge-teal' : 'badge-red'}">${poll.is_active ? 'VOTING OPEN' : 'VOTING LOCKED'}</span>
            <h4 style="font-size: 18px; margin: 8px 0 4px;">${esc(poll.title)}</h4>
            <p style="font-size: 13.5px; color: var(--ink-muted);">${esc(poll.description || '')}</p>
          </div>
          <button class="btn-primary" style="background: ${poll.is_active ? 'var(--red)' : 'var(--teal)'};" onclick="togglePollStatus(${poll.id})">
            ${poll.is_active ? 'Lock / Stop Voting' : 'Reopen Voting'}
          </button>
        </div>
      `;
    } else {
      pollCard.innerHTML = `
        ${pendingHtml}
        <p style="color: var(--ink-muted);">No active poll currently configured.</p>
      `;
    }
  }

  // 5. Team Directory
  const rosterTbody = document.getElementById('adminRosterTableBody');
  if (rosterTbody) {
    rosterTbody.innerHTML = DATA.teamMembers.map(m => `
      <tr>
        <td><b>${esc(m.name)}</b></td>
        <td>${esc(m.department_name)}</td>
        <td>${esc(m.role_title)}</td>
        <td style="text-align: right;">
          <button class="btn-icon-action" onclick="openEditMemberModal(${m.id})">Edit</button>
          <button class="btn-icon-action delete" onclick="deleteMember(${m.id})">Remove</button>
        </td>
      </tr>
    `).join('');
  }

  // 6. Admin Passwords & Role Delegation Table
  await renderAdminPasswordsTable();

  // 7. Personal Windows & PINs Directory Table
  await renderAdminPersonalDirectory();

  // 8. Departments Table
  const deptTbody = document.getElementById('adminDepartmentsTableBody');
  if (deptTbody) {
    deptTbody.innerHTML = DATA.departments.map(d => `
      <tr>
        <td style="font-size: 20px;">${esc(d.icon || '🏢')}</td>
        <td><b>${esc(d.name)}</b></td>
        <td><span class="badge badge-lake">${esc(d.code)}</span></td>
        <td>
          <span style="display: inline-flex; align-items: center; gap: 6px;">
            <span style="width: 14px; height: 14px; border-radius: 50%; background: ${d.color || '#2A6FA8'}; display: inline-block;"></span>
            ${esc(d.color || '#2A6FA8')}
          </span>
        </td>
        <td style="text-align: right;">
          <button class="btn-icon-action" onclick="openEditDepartmentModal(${d.id})">Edit</button>
          <button class="btn-icon-action delete" onclick="deleteDepartment(${d.id})">Delete</button>
        </td>
      </tr>
    `).join('');
  }
}

// Confidential Bottlenecks Review in Admin
function renderAdminBottlenecks() {
  const tbody = document.getElementById('adminBottlenecksTableBody');
  if (!tbody) return;

  const filterEl = document.getElementById('adminBottleneckStatusFilter');
  const filter = filterEl ? filterEl.value : 'all';

  let list = DATA.bottlenecks || [];
  if (filter !== 'all') {
    list = list.filter(b => b.status === filter);
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--ink-muted); padding: 24px;">No bottlenecks found matching '${filter}'.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(b => {
    const sevBadge = b.severity === 'Critical'
      ? `<span class="badge badge-red">🔴 Critical</span>`
      : `<span class="badge badge-gold">🟠 ${esc(b.severity)}</span>`;

    let statusBadge = 'badge-lake';
    if (b.status === 'Under Review') statusBadge = 'badge-gold';
    if (b.status === 'In Discussion') statusBadge = 'badge-lake';
    if (b.status === 'Solution Linked') statusBadge = 'badge-teal';
    if (b.status === 'Resolved') statusBadge = 'badge-teal';

    const solutionsPreview = `
      <div style="font-size: 11px; line-height: 1.35; max-width: 260px;">
        ${b.solution_1 ? `<div><b>1. Quick:</b> ${esc(b.solution_1)}</div>` : ''}
        ${b.solution_2 ? `<div><b>2. Auto:</b> ${esc(b.solution_2)}</div>` : ''}
        ${b.solution_3 ? `<div><b>3. Process:</b> ${esc(b.solution_3)}</div>` : ''}
      </div>
    `;

    const notesPreview = b.admin_notes
      ? `<div style="font-size: 11.5px; color: #047857; background: #ECFDF5; padding: 4px 8px; border-radius: 4px; border: 1px solid #A7F3D0; max-width: 200px;">${esc(b.admin_notes)}</div>`
      : `<span style="font-size: 11px; color: var(--ink-muted); font-style: italic;">No feedback yet</span>`;

    return `
      <tr>
        <td>${sevBadge}<div style="font-size: 11px; color: var(--ink-muted); margin-top: 2px;">${b.hours_lost_week ? b.hours_lost_week + ' hrs/wk' : ''}</div></td>
        <td><span class="badge badge-lake">${esc(b.department_name)}</span></td>
        <td>
          <b>${esc(b.title)}</b>
          <div style="font-size: 11.5px; color: var(--ink-muted); margin-top: 2px;">By <b>${esc(b.reported_by)}</b> • ${formatDate(b.created_at)}</div>
          <div style="font-size: 12px; color: var(--ink); margin-top: 4px;">${esc(b.details)}</div>
        </td>
        <td>${solutionsPreview}</td>
        <td><span class="badge ${statusBadge}">${esc(b.status || 'Under Review')}</span></td>
        <td>${notesPreview}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn-icon-action" onclick="openReviewBottleneckModal(${b.id})">🔍 Review & Reply</button>
          <button class="btn-icon-action delete" onclick="deleteBottleneck(${b.id})">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Admin Passwords Management with Show/Hide & Permissions Matrix
let adminPasswordsCache = [];
async function renderAdminPasswordsTable() {
  const pwTbody = document.getElementById('adminPasswordsTableBody');
  if (!pwTbody) return;

  try {
    const res = await fetch('/api/admin/passwords');
    const json = await res.json();
    if (!json.success) return;

    adminPasswordsCache = json.admins || [];
    pwTbody.innerHTML = adminPasswordsCache.map(a => {
      let permsBadges = '';
      if (a.permissions.includes('all')) {
        permsBadges = `<span class="badge badge-gold" style="font-size: 10px;">👑 Full Admin (All Modules)</span>`;
      } else {
        const labels = {
          links: '🔗 Links',
          announcements: '📢 Updates',
          bottlenecks: '🚧 Hurdles',
          departments: '🏢 Depts',
          polls: '🗳️ Polls',
          roster: '👥 Team',
          passwords: '🔑 Passwords'
        };
        permsBadges = a.permissions.map(p => `<span class="badge badge-lake" style="font-size: 9.5px; margin: 1px;">${labels[p] || p}</span>`).join(' ');
      }

      const isVisible = !!visiblePasswords[a.id];
      const pwDisplay = isVisible
        ? `<code style="background: #FEF3C7; color: #92400E; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 12px;">${esc(a.plain_preview)}</code>`
        : `<span style="letter-spacing: 2px; color: var(--ink-muted); font-size: 12px;">••••••••</span>`;

      return `
        <tr>
          <td><b>${esc(a.admin_name)}</b></td>
          <td><div style="display: flex; flex-wrap: wrap; gap: 3px; max-width: 260px;">${permsBadges}</div></td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              ${pwDisplay}
              <button class="btn-icon-action" onclick="togglePasswordVisibility(${a.id})" title="${isVisible ? 'Hide password' : 'Show password'}">
                ${isVisible ? '🙈 Hide' : '👁️ Show'}
              </button>
            </div>
          </td>
          <td style="color: var(--ink-muted); font-size: 12px;">${formatDate(a.created_at)}</td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn-icon-action" onclick="openEditAdminPasswordModal(${a.id})">✏️ Edit</button>
            <button class="btn-icon-action delete" onclick="deleteAdminPassword(${a.id})">🗑️ Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load admin passwords:', err);
  }
}

function togglePasswordVisibility(id) {
  visiblePasswords[id] = !visiblePasswords[id];
  renderAdminPasswordsTable();
}

// ── ADMIN ACTIONS ─────────────────────────────────────────────
async function deleteLink(id) {
  const link = DATA.links.find(l => l.id === id);
  const name = link ? `"${link.title}"` : 'this link';
  if (!confirm(`Are you sure you want to remove ${name}?`)) return;
  try {
    const res = await fetch(`/api/links/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('Link removed successfully', 'success');
      await refreshData();
    } else {
      showToast(json.error || 'Failed to delete link', 'error');
    }
  } catch (err) {
    showToast('Network error while deleting link', 'error');
  }
}

async function deleteAnnouncement(id) {
  if (!confirm('Are you sure you want to delete this company update?')) return;
  try {
    const res = await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('Company update removed', 'success');
      await refreshData();
    }
  } catch (err) {
    showToast('Failed to delete announcement', 'error');
  }
}

async function deleteBottleneck(id) {
  if (!confirm('Are you sure you want to delete this bottleneck record?')) return;
  try {
    const res = await fetch(`/api/bottlenecks/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('Bottleneck deleted', 'success');
      await refreshData();
    }
  } catch (err) {
    showToast('Failed to delete bottleneck', 'error');
  }
}

async function deleteMember(id) {
  if (!confirm('Remove this team member from directory?')) return;
  await fetch(`/api/team-members/${id}`, { method: 'DELETE' });
  showToast('Member removed', 'success');
  await refreshData();
}

async function deleteAdminPassword(id) {
  if (!confirm('Delete this admin password?')) return;
  const res = await fetch(`/api/admin/passwords/${id}`, { method: 'DELETE' });
  const json = await res.json();
  if (!res.ok || !json.success) {
    showToast(json.error || 'Cannot delete', 'error');
    return;
  }
  showToast('Admin password deleted', 'success');
  await renderAdminPasswordsTable();
}

async function togglePollStatus() {
  const poll = DATA.activePoll;
  if (!poll) return;
  const res = await fetch(`/api/polls/${poll.id}/toggle`, { method: 'PATCH' });
  const json = await res.json();
  if (json.success) {
    showToast(json.message, 'success');
    await refreshData();
  }
}

// ── MODAL SAVE ACTIONS ────────────────────────────────────────
function openAddLinkModal() {
  document.getElementById('linkModalTitle').textContent = 'Add New Link';
  document.getElementById('linkModalEditId').value = '';
  document.getElementById('linkModalTitleInput').value = '';
  document.getElementById('linkModalUrlInput').value = '';
  document.getElementById('linkModalTagsInput').value = '';
  openModal('linkModal');
}

function openEditLinkModal(id) {
  const link = DATA.links.find(l => l.id === id);
  if (!link) return;
  document.getElementById('linkModalTitle').textContent = 'Edit Link';
  document.getElementById('linkModalEditId').value = link.id;
  document.getElementById('linkModalTitleInput').value = link.title;
  document.getElementById('linkModalUrlInput').value = link.url;
  document.getElementById('linkModalCategorySelect').value = link.category;
  document.getElementById('linkModalIconInput').value = link.icon || '🔗';
  document.getElementById('linkModalDeptSelect').value = link.department_id || '';
  document.getElementById('linkModalTagsInput').value = link.tags || '';
  openModal('linkModal');
}

async function saveLinkRecord() {
  const id = document.getElementById('linkModalEditId').value;
  const title = document.getElementById('linkModalTitleInput').value.trim();
  const url = document.getElementById('linkModalUrlInput').value.trim();
  const category = document.getElementById('linkModalCategorySelect').value;
  const icon = document.getElementById('linkModalIconInput').value.trim();
  const department_id = document.getElementById('linkModalDeptSelect').value;
  const tags = document.getElementById('linkModalTagsInput').value.trim();

  if (!title || !url) {
    showToast('Title and URL are required', 'error');
    return;
  }

  const endpoint = id ? `/api/links/${id}` : '/api/links';
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, url, category, icon, department_id, tags })
  });

  const json = await res.json();
  if (json.success) {
    closeModal('linkModal');
    showToast(id ? 'Link updated!' : 'Link created!', 'success');
    await refreshData();
  }
}

function openSubmitIdeaModal() {
  document.getElementById('ideaModalTitle').textContent = 'Submit Idea for Voting';
  document.getElementById('ideaModalEditId').value = '';
  document.getElementById('ideaModalTitleInput').value = '';
  document.getElementById('ideaModalDescInput').value = '';
  document.getElementById('ideaModalImpactInput').value = '';
  document.getElementById('ideaModalTagsInput').value = '';
  document.getElementById('ideaModalSaveBtn').textContent = 'Submit Idea for Polling';

  populateSubmitterSelect('ideaModalSubmitterSelect', currentUser.name);
  handleIdeaSubmitterChange();
  openModal('ideaModal');
}

function openEditIdeaModal(id) {
  const idea = DATA.ideas.find(i => i.id === id);
  if (!idea) return;

  document.getElementById('ideaModalTitle').textContent = 'Edit Submitted Idea';
  document.getElementById('ideaModalEditId').value = idea.id;
  document.getElementById('ideaModalTitleInput').value = idea.title;
  document.getElementById('ideaModalCategorySelect').value = idea.category;
  document.getElementById('ideaModalDescInput').value = idea.description;
  document.getElementById('ideaModalImpactInput').value = idea.expected_impact || '';
  document.getElementById('ideaModalTagsInput').value = idea.tags || '';
  document.getElementById('ideaModalSaveBtn').textContent = 'Update Idea';

  populateSubmitterSelect('ideaModalSubmitterSelect', idea.submitter_name);
  document.getElementById('ideaModalDeptSelect').value = idea.department_id;
  openModal('ideaModal');
}

function handleIdeaSubmitterChange() {
  const select = document.getElementById('ideaModalSubmitterSelect');
  const opt = select ? select.options[select.selectedIndex] : null;
  if (opt && opt.dataset.dept) {
    document.getElementById('ideaModalDeptSelect').value = opt.dataset.dept;
  }
}

async function saveIdeaRecord() {
  const id = document.getElementById('ideaModalEditId').value;
  const submitterSelect = document.getElementById('ideaModalSubmitterSelect');
  const submitter_name = submitterSelect && submitterSelect.value ? submitterSelect.value : currentUser.name;
  const title = document.getElementById('ideaModalTitleInput').value.trim();
  const department_id = document.getElementById('ideaModalDeptSelect').value;
  const category = document.getElementById('ideaModalCategorySelect').value;
  const description = document.getElementById('ideaModalDescInput').value.trim();
  const expected_impact = document.getElementById('ideaModalImpactInput').value.trim();
  const bottleneck_id = document.getElementById('ideaModalBottleneckSelect').value;
  const tags = document.getElementById('ideaModalTagsInput').value.trim();

  if (!title || !description || !submitter_name) {
    showToast('Please fill in title, description, and submitter name', 'error');
    return;
  }

  const endpoint = id ? `/api/ideas/${id}` : '/api/ideas';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        department_id: parseInt(department_id),
        category,
        description,
        expected_impact,
        bottleneck_id: bottleneck_id ? parseInt(bottleneck_id) : null,
        tags,
        submitter_name
      })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showToast(json.error || 'Failed to save idea', 'error');
      return;
    }

    closeModal('ideaModal');
    showToast(json.message || (id ? 'Idea updated successfully!' : 'Idea submitted! Admin notified to allow voting poll.'), 'success');
    await refreshData();
    if (personalSession.authenticated) {
      await refreshPersonalWindowData();
    }
  } catch (err) {
    showToast('Network error while saving idea', 'error');
  }
}

async function deleteIdea(id) {
  if (!confirm('Are you sure you want to delete this idea?')) return;
  try {
    const res = await fetch(`/api/ideas/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('Idea deleted successfully', 'success');
      await refreshData();
      if (personalSession.authenticated) {
        await refreshPersonalWindowData();
      }
    }
  } catch (err) {
    showToast('Error deleting idea', 'error');
  }
}

async function allowIdeaPoll(id) {
  try {
    const res = await fetch(`/api/ideas/${id}/allow-poll`, { method: 'PATCH' });
    const json = await res.json();
    if (json.success) {
      showToast(json.message || 'Voting poll opened for this idea! Department team can now vote.', 'success');
      await refreshData();
      if (personalSession.authenticated) {
        await refreshPersonalWindowData();
      }
    } else {
      showToast(json.error || 'Failed to allow poll', 'error');
    }
  } catch (err) {
    showToast('Failed to allow voting poll', 'error');
  }
}

async function toggleIdeaLock(id) {
  try {
    const res = await fetch(`/api/ideas/${id}/lock`, { method: 'PATCH' });
    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      await refreshData();
      if (personalSession.authenticated) {
        await refreshPersonalWindowData();
      }
    }
  } catch (err) {
    showToast('Failed to toggle voting lock', 'error');
  }
}

async function toggleIdeaSelect(id) {
  try {
    const res = await fetch(`/api/ideas/${id}/select`, { method: 'PATCH' });
    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      await refreshData();
      if (personalSession.authenticated) {
        await refreshPersonalWindowData();
      }
      if (json.is_selected) {
        const idea = DATA.ideas.find(i => i.id === id);
        if (idea) {
          triggerCelebration(idea.title, idea.submitter_name, idea.department_name, 'SELECTED FOR IMPLEMENTATION');
        }
      }
    }
  } catch (err) {
    showToast('Failed to select idea', 'error');
  }
}

function openCelebrationForIdea(id) {
  const idea = DATA.ideas.find(i => i.id === id);
  if (idea) {
    triggerCelebration(idea.title, idea.submitter_name, idea.department_name, idea.is_selected ? 'SELECTED FOR IMPLEMENTATION' : 'DEPARTMENT BEST CHOICE');
  }
}

function openReportHurdleModal() {
  document.getElementById('hurdleModalTitleInput').value = '';
  document.getElementById('hurdleModalDetailsInput').value = '';
  document.getElementById('hurdleModalHoursInput').value = '';
  document.getElementById('hurdleModalTagsInput').value = '';
  document.getElementById('hurdleModalSolution1Input').value = '';
  document.getElementById('hurdleModalSolution2Input').value = '';
  document.getElementById('hurdleModalSolution3Input').value = '';

  populateSubmitterSelect('hurdleModalSubmitterSelect', currentUser.name);
  handleHurdleSubmitterChange();
  openModal('hurdleModal');
}

function handleHurdleSubmitterChange() {
  const select = document.getElementById('hurdleModalSubmitterSelect');
  const opt = select ? select.options[select.selectedIndex] : null;
  if (opt && opt.dataset.dept) {
    document.getElementById('hurdleModalDeptSelect').value = opt.dataset.dept;
  }
}

async function saveHurdleRecord() {
  const submitterSelect = document.getElementById('hurdleModalSubmitterSelect');
  const reported_by = submitterSelect && submitterSelect.value ? submitterSelect.value : currentUser.name;
  const title = document.getElementById('hurdleModalTitleInput').value.trim();
  const department_id = document.getElementById('hurdleModalDeptSelect').value;
  const severity = document.getElementById('hurdleModalSeveritySelect').value;
  const details = document.getElementById('hurdleModalDetailsInput').value.trim();
  const hours_lost_week = document.getElementById('hurdleModalHoursInput').value;
  const tags = document.getElementById('hurdleModalTagsInput').value.trim();
  const solution_1 = document.getElementById('hurdleModalSolution1Input').value.trim();
  const solution_2 = document.getElementById('hurdleModalSolution2Input').value.trim();
  const solution_3 = document.getElementById('hurdleModalSolution3Input').value.trim();

  if (!title || !details || !reported_by) {
    showToast('Please provide your name, hurdle title, and details', 'error');
    return;
  }

  if (!solution_1 || !solution_2 || !solution_3) {
    showToast('Please provide all 3 proposed solutions (minimum requirement)', 'error');
    return;
  }

  try {
    const res = await fetch('/api/bottlenecks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        department_id: parseInt(department_id),
        severity,
        details,
        hours_lost_week: parseFloat(hours_lost_week) || 0,
        tags,
        solution_1,
        solution_2,
        solution_3,
        reported_by
      })
    });

    const json = await res.json();
    if (json.success) {
      closeModal('hurdleModal');
      showToast('Bottleneck logged under review! Only you and Admin can view this.', 'success');
      await refreshData();
      if (personalSession.authenticated && personalSession.member && personalSession.member.name.toLowerCase() === reported_by.toLowerCase()) {
        try {
          const bRes = await fetch(`/api/bottlenecks?user_name=${encodeURIComponent(reported_by)}`);
          const bJson = await bRes.json();
          if (bJson.success) personalSession.bottlenecks = bJson.bottlenecks || [];
        } catch(e) {}
        renderPersonalWindow();
        openModal('personalWindowModal');
      } else {
        openPersonalLoginModal(reported_by);
      }
    } else {
      showToast(json.error || 'Failed to submit hurdle', 'error');
    }
  } catch (err) {
    showToast('Network error while saving hurdle', 'error');
  }
}

// ── PERSONAL WINDOW & AUTHENTICATION ENGINE ──────────────────
function openMyBottlenecksModal() {
  handlePersonalWindowClick();
}

function checkUrlParamsForPersonalWindow() {
  const params = new URLSearchParams(window.location.search);
  const personalName = params.get('personal');
  const memberId = params.get('member_id');
  if (personalName || memberId) {
    let targetName = personalName;
    if (memberId && DATA.teamMembers) {
      const found = DATA.teamMembers.find(m => String(m.id) === String(memberId));
      if (found) targetName = found.name;
    }
    openPersonalLoginModal(targetName);
    if (targetName) {
      showToast(`Personal Window: Enter 4-digit PIN for ${targetName}`, 'info');
    }
  }
}

function openPersonalLoginModal(defaultName) {
  const select = document.getElementById('personalLoginMemberSelect');
  if (select && DATA.teamMembers && DATA.teamMembers.length > 0) {
    const selectedName = defaultName || (currentUser && currentUser.name) || '';
    select.innerHTML = DATA.teamMembers.map(m => {
      const isSel = selectedName && m.name.toLowerCase().trim() === selectedName.toLowerCase().trim();
      return `<option value="${m.id}" data-name="${esc(m.name)}" ${isSel ? 'selected' : ''}>${esc(m.name)} (${esc(m.department_name)} - ${esc(m.role_title)})</option>`;
    }).join('');
  }
  const passInput = document.getElementById('personalLoginPassInput');
  if (passInput) {
    passInput.value = '';
    setTimeout(() => passInput.focus(), 180);
  }
  openModal('personalLoginModal');
}

function onPersonalLoginMemberChange() {
  const passInput = document.getElementById('personalLoginPassInput');
  if (passInput) {
    passInput.value = '';
    passInput.focus();
  }
}

function handlePersonalWindowClick() {
  if (personalSession.authenticated && personalSession.member) {
    renderPersonalWindow();
    openModal('personalWindowModal');
  } else {
    openPersonalLoginModal(currentUser ? currentUser.name : '');
  }
}

async function executePersonalLogin() {
  const select = document.getElementById('personalLoginMemberSelect');
  const passInput = document.getElementById('personalLoginPassInput');
  const memberId = select ? select.value : null;
  const password = passInput ? passInput.value.trim() : '';

  if (!memberId) {
    showToast('Please select your team member profile', 'error');
    return;
  }
  if (!password) {
    showToast('Please enter your 4-digit personal PIN', 'error');
    return;
  }

  try {
    const res = await fetch('/api/personal/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: parseInt(memberId), password })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showToast(json.error || 'Incorrect personal passkey/PIN', 'error');
      return;
    }

    personalSession.authenticated = true;
    personalSession.member = json.member;
    personalSession.bottlenecks = json.bottlenecks || [];
    personalSession.ideas = json.ideas || [];
    personalSession.department_ideas = json.department_ideas || [];
    personalSession.selected_idea = json.selected_idea || null;
    personalSession.personal_links = json.personal_links || [];

    currentUser = {
      name: json.member.name,
      department_id: json.member.department_id,
      department_name: json.member.department_name
    };
    unlockedDeptIds.add(json.member.department_id);
    updateIdentityDisplay();

    closeModal('personalLoginModal');
    renderPersonalWindow();
    openModal('personalWindowModal');
    updatePrivateTrackerBadge();
    showToast(json.message || `Welcome, ${json.member.name}!`, 'success');
  } catch (err) {
    showToast('Network error during personal authentication', 'error');
  }
}

function renderPersonalWindow() {
  if (!personalSession.authenticated || !personalSession.member) return;
  const m = personalSession.member;

  // Header Banner
  const avatarEl = document.getElementById('pBannerAvatar');
  if (avatarEl) avatarEl.textContent = m.name ? m.name.charAt(0).toUpperCase() : '👤';
  const nameEl = document.getElementById('pBannerName');
  if (nameEl) nameEl.textContent = m.name;
  const deptEl = document.getElementById('pBannerDept');
  if (deptEl) deptEl.textContent = m.department_name;
  const roleEl = document.getElementById('pBannerRole');
  if (roleEl) roleEl.textContent = m.role_title || 'Team Member';
  const footerEl = document.getElementById('pFooterMemberName');
  if (footerEl) footerEl.textContent = m.name;

  // Selection Alert Banner
  const alertBanner = document.getElementById('pSelectionAlertBanner');
  if (alertBanner) {
    if (personalSession.selected_idea) {
      alertBanner.style.display = 'flex';
      const titleEl = document.getElementById('pSelectionAlertTitle');
      if (titleEl) titleEl.textContent = `🎯 Idea Selected: "${personalSession.selected_idea.title}"`;
      const textEl = document.getElementById('pSelectionAlertText');
      if (textEl) textEl.textContent = `Congratulations! Your automation idea pitched for ${personalSession.member.department_name} has been selected by Leadership for implementation!`;
    } else {
      alertBanner.style.display = 'none';
    }
  }

  // Counter Badges
  const btnBadge = document.getElementById('pTabBottlenecksBadge');
  if (btnBadge) btnBadge.textContent = personalSession.bottlenecks.length;
  const linkBadge = document.getElementById('pTabLinksBadge');
  if (linkBadge) linkBadge.textContent = personalSession.personal_links.length;
  const ideaBadge = document.getElementById('pTabIdeasBadge');
  if (ideaBadge) ideaBadge.textContent = (personalSession.department_ideas || []).length;

  updatePrivateTrackerBadge();

  // TAB 1: Bottlenecks
  renderPersonalBottlenecksList();

  // TAB 2: Private Links
  renderPersonalLinksList();

  // TAB 3: Department Ideas & In-Window Voting
  renderPersonalDepartmentIdeasList();
}

function renderPersonalBottlenecksList() {
  const listEl = document.getElementById('myBottlenecksList');
  if (!listEl) return;

  const bottlenecks = personalSession.bottlenecks || [];
  if (bottlenecks.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding: 30px 10px;">
        <div style="font-size: 36px; margin-bottom: 8px;">🌱</div>
        <h4>No Hurdles Reported Yet</h4>
        <p style="font-size: 13px; color: var(--ink-muted);">You haven't submitted any department bottlenecks yet. Report one anytime to get leadership review and action support!</p>
        <button class="btn-primary" style="background: var(--red); margin-top: 12px;" onclick="closeModal('personalWindowModal'); openReportHurdleModal();">+ Report First Hurdle</button>
      </div>
    `;
    return;
  }

  const stages = ['Submitted', 'Under Review', 'Solution Linked', 'Resolved'];

  listEl.innerHTML = bottlenecks.map(b => {
    const currentStatus = b.status || 'Under Review';
    let currentIdx = stages.indexOf(currentStatus);
    if (currentIdx === -1) currentIdx = 1;

    const timelineHtml = `
      <div class="timeline-stages">
        ${stages.map((stage, idx) => {
          let dotClass = '';
          if (idx < currentIdx) dotClass = 'done';
          else if (idx === currentIdx) dotClass = 'active';

          return `
            <div class="timeline-dot-wrap">
              <div class="timeline-dot ${dotClass}">${idx < currentIdx ? '✓' : (idx + 1)}</div>
              <div class="timeline-stage-label ${idx === currentIdx ? 'active' : ''}">${stage}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    const adminFeedbackHtml = b.admin_notes ? `
      <div style="background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 6px; padding: 10px 12px; margin-top: 10px;">
        <div style="font-size: 11px; font-weight: 700; color: #065F46; text-transform: uppercase; margin-bottom: 3px; display: flex; align-items: center; gap: 5px;">
          <span>💬</span> Leadership Feedback & Action Plan:
        </div>
        <div style="font-size: 12.5px; color: #047857; line-height: 1.4;">${esc(b.admin_notes)}</div>
      </div>
    ` : `
      <div style="background: var(--snow); border: 1px dashed var(--border); border-radius: 6px; padding: 8px 12px; margin-top: 10px; font-size: 12px; color: var(--ink-muted); font-style: italic;">
        ⏳ Under management review — leadership response and assigned action plans will appear here.
      </div>
    `;

    return `
      <div class="card" style="border: 1px solid var(--border); padding: 14px 16px; margin: 0; background: white;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div>
            <span class="badge ${b.severity === 'Critical' ? 'badge-red' : 'badge-gold'}">${esc(b.severity)} Friction</span>
            ${b.hours_lost_week ? `<span style="font-size: 11.5px; color: var(--red); font-weight: 600; margin-left: 6px;">⚠️ ${b.hours_lost_week} hrs/wk</span>` : ''}
          </div>
          <span style="font-size: 11.5px; color: var(--ink-muted);">${formatDate(b.created_at)}</span>
        </div>

        <h4 style="font-size: 15px; margin: 4px 0 6px; color: var(--ink);">${esc(b.title)}</h4>
        <p style="font-size: 12.5px; color: var(--ink-muted); line-height: 1.4; margin-bottom: 10px;">${esc(b.details)}</p>

        <!-- 3 Solutions Summary -->
        <div style="background: var(--snow); padding: 8px 12px; border-radius: 6px; font-size: 11.5px; margin-bottom: 10px; border: 1px solid var(--border);">
          <div style="font-weight: 700; color: var(--lake); margin-bottom: 4px;">💡 3 Proposed Solutions:</div>
          ${b.solution_1 ? `<div><b>1. Quick:</b> ${esc(b.solution_1)}</div>` : ''}
          ${b.solution_2 ? `<div><b>2. Automation:</b> ${esc(b.solution_2)}</div>` : ''}
          ${b.solution_3 ? `<div><b>3. Process:</b> ${esc(b.solution_3)}</div>` : ''}
        </div>

        <!-- 4-Stage Progress Timeline -->
        ${timelineHtml}

        <!-- Management Review Note -->
        ${adminFeedbackHtml}
      </div>
    `;
  }).join('');
}

function renderPersonalLinksList() {
  const listEl = document.getElementById('myPersonalLinksList');
  if (!listEl) return;

  const links = personalSession.personal_links || [];
  if (links.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding: 30px 10px;">
        <div style="font-size: 36px; margin-bottom: 8px;">📂</div>
        <h4>No Assigned Private Links Yet</h4>
        <p style="font-size: 13px; color: var(--ink-muted);">Your direct manager or admin can assign personal KPI spreadsheets, private forms, or payroll portals to your account.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = links.map(l => `
    <div class="personal-link-card">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 22px;">📑</span>
        <div>
          <div style="font-weight: 700; font-size: 13.5px; color: var(--ink);">${esc(l.title)}</div>
          <div style="font-size: 11.5px; color: var(--ink-muted); max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(l.url)}</div>
        </div>
      </div>
      <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="font-size: 12px; padding: 6px 14px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
        Open ↗
      </a>
    </div>
  `).join('');
}

function renderPersonalDepartmentIdeasList() {
  const listEl = document.getElementById('myPersonalIdeasList');
  if (!listEl) return;

  const ideas = personalSession.department_ideas || [];
  if (ideas.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding: 30px 10px;">
        <div style="font-size: 36px; margin-bottom: 8px;">💡</div>
        <h4>No Department Ideas Pitched Yet</h4>
        <p style="font-size: 13px; color: var(--ink-muted);">Be the first to pitch an automation or workflow idea for <b>${esc(personalSession.member.department_name)}</b>!</p>
        <button class="btn-primary" style="margin-top: 12px;" onclick="openSubmitDeptIdeaModal()">+ Pitch First Idea</button>
      </div>
    `;
    return;
  }

  listEl.innerHTML = ideas.map(i => {
    const isSelected = i.is_selected === 1 || i.status === 'Selected';
    const isLocked = i.is_locked === 1;
    const isPending = i.poll_allowed === 0;
    const isAuthor = personalSession.member.name && i.submitter_name && personalSession.member.name.toLowerCase().trim() === i.submitter_name.toLowerCase().trim();

    const selectedBadge = isSelected
      ? `<span class="badge-selected-idea">🎯 SELECTED FOR IMPLEMENTATION</span>`
      : '';
    const pendingBadge = isPending
      ? `<span class="badge" style="background: #FEF3C7; color: #92400E; font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 12px;">⏳ Pending Admin Approval</span>`
      : '';
    const lockedBadge = (isLocked && !isPending && !isSelected)
      ? `<span class="badge-locked-idea">🔒 Voting Closed</span>`
      : '';
    const activeBadge = (!isLocked && !isPending && !isSelected)
      ? `<span class="badge badge-teal" style="font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 12px;">▶️ Polling Open</span>`
      : '';

    let voteBtn = '';
    if (isPending) {
      voteBtn = `<button class="vote-btn" disabled style="opacity: 0.6; cursor: not-allowed; background: #E2E8F0; color: var(--ink-muted); font-size: 12px; padding: 5px 12px;">⏳ Awaiting Admin Approval</button>`;
    } else if (isLocked) {
      voteBtn = `<button class="vote-btn" disabled style="opacity: 0.6; cursor: not-allowed; background: #E2E8F0; color: var(--ink-muted); font-size: 12px; padding: 5px 12px;">🔒 Voting Closed</button>`;
    } else {
      voteBtn = `<button class="vote-btn" style="font-size: 12px; padding: 5px 14px;" onclick="castPersonalIdeaVote(${i.id})">▲ Upvote</button>`;
    }

    let actionsHtml = '';
    if (isAuthor || isAdmin) {
      actionsHtml = `
        <div style="display: flex; gap: 6px; margin-top: 8px;">
          <button class="card-action-btn" onclick="openEditIdeaModal(${i.id})">✏️ Edit</button>
          <button class="card-action-btn btn-delete-idea" onclick="deleteIdea(${i.id})">🗑️ Delete</button>
        </div>
      `;
    }

    return `
      <div class="card" style="border: 1px solid ${isSelected ? '#F59E0B' : 'var(--border)'}; padding: 14px 16px; margin: 0; background: white; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; flex-wrap: wrap; gap: 6px;">
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <span class="badge badge-lake">${esc(i.category || 'Automation')}</span>
            ${selectedBadge}
            ${pendingBadge}
            ${lockedBadge}
            ${activeBadge}
          </div>
          <span style="font-size: 11.5px; color: var(--ink-muted);">By <b>${esc(i.submitter_name)}</b> • ${esc(i.department_name)}</span>
        </div>

        <h4 style="font-size: 15px; margin: 4px 0 6px; color: var(--ink);">${esc(i.title)}</h4>
        <p style="font-size: 12.5px; color: var(--ink-muted); margin-bottom: 8px; line-height: 1.4;">${esc(i.description)}</p>

        ${i.expected_impact ? `<div style="font-size: 12px; color: #B45309; font-weight: 600; margin-bottom: 8px;">🚀 Impact: ${esc(i.expected_impact)}</div>` : ''}

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 10px; margin-top: 6px;">
          <div style="font-size: 13px; font-weight: 700; color: var(--lake);">
            👍 ${i.total_votes || 0} Votes <span style="font-size: 11px; font-weight: normal; color: var(--ink-muted);">(${i.dept_votes || 0} in department)</span>
          </div>
          <div>${voteBtn}</div>
        </div>
        ${actionsHtml}
      </div>
    `;
  }).join('');
}

async function castPersonalIdeaVote(ideaId) {
  if (!personalSession.authenticated || !personalSession.member) return;
  try {
    const res = await fetch(`/api/ideas/${ideaId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voter_name: personalSession.member.name,
        voter_department_id: personalSession.member.department_id
      })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showToast(json.error || 'Vote failed', 'error');
      return;
    }
    showToast(json.message || 'Vote recorded successfully!', 'success');
    await refreshPersonalWindowData();
    await refreshData();
  } catch (err) {
    showToast('Network error while recording vote.', 'error');
  }
}

async function refreshPersonalWindowData() {
  if (!personalSession.authenticated || !personalSession.member) return;
  try {
    const res = await fetch(`/api/ideas?dept_id=${personalSession.member.department_id}&user_name=${encodeURIComponent(personalSession.member.name)}`);
    const json = await res.json();
    if (json.success) {
      personalSession.department_ideas = json.ideas;
      personalSession.ideas = json.ideas.filter(i => (i.submitter_name || '').toLowerCase() === personalSession.member.name.toLowerCase());
      personalSession.selected_idea = personalSession.ideas.find(i => i.is_selected === 1) || null;
      renderPersonalWindow();
    }
  } catch (e) {
    console.error('Error refreshing personal window data', e);
  }
}

function openSubmitDeptIdeaModal() {
  openSubmitIdeaModal();
  if (personalSession.authenticated && personalSession.member) {
    const submitterSelect = document.getElementById('ideaModalSubmitterSelect');
    if (submitterSelect) submitterSelect.value = personalSession.member.name;
    const deptSelect = document.getElementById('ideaModalDeptSelect');
    if (deptSelect) deptSelect.value = personalSession.member.department_id;
  }
}

function switchPersonalTab(tabId, btnEl) {
  document.querySelectorAll('.p-tab-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.p-tab-btn').forEach(b => b.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.style.display = 'block';
  if (btnEl) btnEl.classList.add('active');
}

function lockPersonalWindow() {
  personalSession.authenticated = false;
  personalSession.member = null;
  personalSession.bottlenecks = [];
  personalSession.ideas = [];
  personalSession.department_ideas = [];
  personalSession.selected_idea = null;
  personalSession.personal_links = [];
  currentUser = { name: '', department_id: null, department_name: '' };
  updateIdentityDisplay();
  closeModal('personalWindowModal');
  updatePrivateTrackerBadge();
  showToast('Personal Window locked securely.', 'info');
}

// ── DIRECT LINK COPIER & VISIBILITY TOGGLES ───────────────────
function copyDirectLink(name, btnEl) {
  const cleanName = (name || '').trim();
  const url = `${window.location.origin}${window.location.pathname}?personal=${encodeURIComponent(cleanName)}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showCopiedFeedback(btnEl, cleanName);
    }).catch(() => fallbackCopy(url, btnEl, cleanName));
  } else {
    fallbackCopy(url, btnEl, cleanName);
  }
}

function fallbackCopy(text, btnEl, name) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showCopiedFeedback(btnEl, name);
}

function showCopiedFeedback(btnEl, name) {
  if (btnEl) {
    const orig = btnEl.innerHTML;
    btnEl.innerHTML = `<span>✓</span> Copied!`;
    btnEl.classList.add('copied');
    setTimeout(() => {
      btnEl.innerHTML = orig;
      btnEl.classList.remove('copied');
    }, 2000);
  }
  showToast(`Direct access link copied for ${name}!`, 'success');
}

function togglePassInputVisibility(inputId, btnEl) {
  const el = document.getElementById(inputId);
  if (!el) return;
  if (el.type === 'password') {
    el.type = 'text';
    if (btnEl) btnEl.textContent = '🙈';
  } else {
    el.type = 'password';
    if (btnEl) btnEl.textContent = '👁️';
  }
}

// ── ADMIN PERSONAL DIRECTORY & CREDENTIALS SUITE ──────────────
async function renderAdminPersonalDirectory() {
  const tbody = document.getElementById('adminPersonalTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/personal-roster');
    const json = await res.json();
    if (!json.success) return;
    adminPersonalRoster = json.roster || [];
    filterAdminPersonalDir();
  } catch (err) {
    console.error('Failed to load personal roster:', err);
  }
}

function filterAdminPersonalDir() {
  const tbody = document.getElementById('adminPersonalTableBody');
  if (!tbody) return;

  const query = (document.getElementById('adminPersonalSearch')?.value || '').toLowerCase().trim();
  let list = adminPersonalRoster;
  if (query) {
    list = list.filter(m => m.name.toLowerCase().includes(query) || (m.department_name && m.department_name.toLowerCase().includes(query)));
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--ink-muted); padding: 24px;">No team members found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(m => {
    const isVisible = !!visibleMemberPins[m.id];
    const pinDisplay = isVisible
      ? `<code style="background: #EFF6FF; color: #1D4ED8; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 12.5px; border: 1px solid #BFDBFE;">${esc(m.plain_preview || '1234')}</code>`
      : `<span style="letter-spacing: 3px; color: var(--ink-muted); font-size: 13px;">••••</span>`;

    const linksBadge = m.personal_links_count > 0
      ? `<span class="badge badge-teal">${m.personal_links_count} assigned link${m.personal_links_count > 1 ? 's' : ''}</span>`
      : `<span style="font-size: 11.5px; color: var(--ink-muted); font-style: italic;">None assigned</span>`;

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: #EFF6FF; color: var(--lake); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; border: 1px solid #BFDBFE;">
              ${m.name.charAt(0).toUpperCase()}
            </div>
            <b>${esc(m.name)}</b>
          </div>
        </td>
        <td>
          <div><span class="badge badge-lake">${esc(m.department_icon || '🏢')} ${esc(m.department_name)}</span></div>
          <div style="font-size: 11.5px; color: var(--ink-muted); margin-top: 2px;">${esc(m.role_title)}</div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${pinDisplay}
            <button class="pass-toggle-btn" onclick="toggleMemberPinVisibility(${m.id})" title="${isVisible ? 'Hide PIN' : 'Reveal PIN'}">
              ${isVisible ? '🙈 Hide' : '👁️ Show'}
            </button>
          </div>
        </td>
        <td>${linksBadge}</td>
        <td>
          <button class="btn-copy-direct-link" onclick="copyDirectLink('${esc(m.name)}', this)" title="Copy direct personal URL for ${esc(m.name)}">
            <span>📋</span> Copy Direct URL
          </button>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn-icon-action" onclick="openEditMemberCredsModal(${m.id})">✏️ Edit PIN & Links</button>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleMemberPinVisibility(id) {
  visibleMemberPins[id] = !visibleMemberPins[id];
  filterAdminPersonalDir();
}

function openEditMemberCredsModal(id) {
  const member = adminPersonalRoster.find(m => m.id === id);
  if (!member) return;

  editingMemberCredsId = member.id;
  editingMemberLinks = JSON.parse(JSON.stringify(member.personal_links || []));

  document.getElementById('adminCredsMemberId').value = member.id;
  document.getElementById('adminCredsMemberName').textContent = member.name;
  document.getElementById('adminCredsMemberMeta').textContent = `${member.department_name} • ${member.role_title}`;
  document.getElementById('adminCredsPinInput').value = member.plain_preview || '1234';

  renderAdminCredsLinksList();
  openModal('adminMemberCredsModal');
}

function renderAdminCredsLinksList() {
  const listEl = document.getElementById('adminCredsLinksList');
  if (!listEl) return;

  if (editingMemberLinks.length === 0) {
    listEl.innerHTML = `<div style="font-size: 12px; color: var(--ink-muted); font-style: italic; padding: 6px 0;">No private links assigned yet. Add one below!</div>`;
    return;
  }

  listEl.innerHTML = editingMemberLinks.map((l, idx) => `
    <div style="background: white; border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; display: flex; justify-content: space-between; align-items: center;">
      <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 360px;">
        <b style="font-size: 12.5px; color: var(--ink);">${esc(l.title)}</b>
        <div style="font-size: 11px; color: var(--ink-muted); overflow: hidden; text-overflow: ellipsis;">${esc(l.url)}</div>
      </div>
      <button type="button" class="btn-icon-action delete" style="padding: 2px 6px; font-size: 11px;" onclick="removeAdminCredsLinkRow(${idx})">🗑️</button>
    </div>
  `).join('');
}

function addAdminCredsLinkRow() {
  const titleInput = document.getElementById('adminCredsNewTitleInput');
  const urlInput = document.getElementById('adminCredsNewUrlInput');
  const title = titleInput ? titleInput.value.trim() : '';
  const url = urlInput ? urlInput.value.trim() : '';

  if (!title || !url) {
    showToast('Please enter both title and URL for the private link', 'error');
    return;
  }

  editingMemberLinks.push({ title, url });
  titleInput.value = '';
  urlInput.value = '';
  renderAdminCredsLinksList();
}

function removeAdminCredsLinkRow(index) {
  editingMemberLinks.splice(index, 1);
  renderAdminCredsLinksList();
}

function copyCredsModalDirectLink() {
  const member = adminPersonalRoster.find(m => m.id === editingMemberCredsId);
  const btn = document.getElementById('adminCredsDirectLinkBtn');
  if (member) {
    copyDirectLink(member.name, btn);
  }
}

async function saveAdminMemberCredsRecord() {
  if (!editingMemberCredsId) return;
  const pin = document.getElementById('adminCredsPinInput').value.trim();

  if (pin && pin.length < 3) {
    showToast('Passkey/PIN must be at least 3 characters', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/admin/team-members/${editingMemberCredsId}/credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        new_password: pin,
        personal_links: editingMemberLinks
      })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showToast(json.error || 'Failed to save credentials', 'error');
      return;
    }

    closeModal('adminMemberCredsModal');
    showToast(json.message || 'Credentials updated successfully!', 'success');
    await renderAdminPersonalDirectory();

    // If active session matches this member, refresh personal session
    if (personalSession.authenticated && personalSession.member && personalSession.member.id === editingMemberCredsId) {
      personalSession.personal_links = editingMemberLinks;
      renderPersonalWindow();
    }
  } catch (err) {
    showToast('Network error while saving credentials', 'error');
  }
}

// ── ADMIN BOTTLENECK REVIEW MODAL ─────────────────────────────
function openReviewBottleneckModal(id) {
  const b = DATA.bottlenecks.find(item => item.id === id);
  if (!b) return;

  document.getElementById('reviewModalBottleneckId').value = b.id;
  document.getElementById('reviewModalSubtitle').textContent = `Reported by ${b.reported_by} (${b.department_name})`;
  document.getElementById('reviewModalTitleDisplay').textContent = b.title;
  document.getElementById('reviewModalMetaDisplay').textContent = `${b.department_name} • Reported by ${b.reported_by} • ${b.severity} Severity • ${b.hours_lost_week ? b.hours_lost_week + ' hrs/wk' : 'Hours not specified'}`;
  document.getElementById('reviewModalDetailsDisplay').textContent = b.details || 'No detailed description provided.';
  document.getElementById('reviewModalSol1Display').textContent = b.solution_1 || 'None suggested';
  document.getElementById('reviewModalSol2Display').textContent = b.solution_2 || 'None suggested';
  document.getElementById('reviewModalSol3Display').textContent = b.solution_3 || 'None suggested';
  document.getElementById('reviewModalStatusSelect').value = b.status || 'Under Review';
  document.getElementById('reviewModalNotesInput').value = b.admin_notes || '';

  openModal('reviewBottleneckModal');
}

async function saveBottleneckReviewRecord() {
  const id = document.getElementById('reviewModalBottleneckId').value;
  const status = document.getElementById('reviewModalStatusSelect').value;
  const admin_notes = document.getElementById('reviewModalNotesInput').value;

  try {
    const res = await fetch(`/api/bottlenecks/${id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, admin_notes })
    });
    const json = await res.json();
    if (json.success) {
      closeModal('reviewBottleneckModal');
      showToast('Bottleneck status & feedback notes saved!', 'success');
      await refreshData();
    } else {
      showToast(json.error || 'Failed to update review', 'error');
    }
  } catch (err) {
    showToast('Network error saving review', 'error');
  }
}

function openAddAnnouncementModal() {
  document.getElementById('announceModalTitle').textContent = 'Post Company Update';
  document.getElementById('announceModalEditId').value = '';
  document.getElementById('announceModalTitleInput').value = '';
  document.getElementById('announceModalContentInput').value = '';
  document.getElementById('announceModalPrioritySelect').value = 'General';
  document.getElementById('announceModalDeptSelect').value = '';
  document.getElementById('announceModalPinnedCheckbox').checked = false;
  document.getElementById('announceModalSaveBtn').textContent = 'Publish Update';
  openModal('announcementModal');
}

function openEditAnnouncementModal(id) {
  const item = DATA.announcements.find(a => a.id === id);
  if (!item) return;

  document.getElementById('announceModalTitle').textContent = 'Edit Company Update';
  document.getElementById('announceModalEditId').value = item.id;
  document.getElementById('announceModalTitleInput').value = item.title || '';
  document.getElementById('announceModalContentInput').value = item.content || '';
  document.getElementById('announceModalPrioritySelect').value = item.priority || 'General';
  document.getElementById('announceModalDeptSelect').value = item.department_id || '';
  document.getElementById('announceModalPinnedCheckbox').checked = !!item.is_pinned;
  document.getElementById('announceModalSaveBtn').textContent = 'Save Changes';
  openModal('announcementModal');
}

async function saveAnnouncementRecord() {
  const editId = document.getElementById('announceModalEditId').value;
  const title = document.getElementById('announceModalTitleInput').value.trim();
  const content = document.getElementById('announceModalContentInput').value.trim();
  const priority = document.getElementById('announceModalPrioritySelect').value;
  const department_id = document.getElementById('announceModalDeptSelect').value;
  const is_pinned = document.getElementById('announceModalPinnedCheckbox').checked;

  if (!title || !content) {
    showToast('Please provide title and content', 'error');
    return;
  }

  const endpoint = editId ? `/api/announcements/${editId}` : '/api/announcements';
  const method = editId ? 'PUT' : 'POST';

  try {
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        content,
        priority,
        department_id: department_id ? parseInt(department_id) : null,
        is_pinned
      })
    });

    const json = await res.json();
    if (json.success) {
      closeModal('announcementModal');
      showToast(editId ? 'Announcement updated successfully!' : 'Announcement posted!', 'success');
      await refreshData();
    } else {
      showToast(json.error || 'Failed to save announcement', 'error');
    }
  } catch (err) {
    showToast('Network error while saving announcement', 'error');
  }
}

function openAddMemberModal() {
  document.getElementById('memberModalTitle').textContent = 'Add Team Member';
  document.getElementById('memberModalEditId').value = '';
  document.getElementById('memberModalNameInput').value = '';
  document.getElementById('memberModalRoleInput').value = '';
  document.getElementById('memberModalSaveBtn').textContent = 'Add Member';
  openModal('memberModal');
}

function openEditMemberModal(id) {
  const member = DATA.teamMembers.find(m => m.id === id);
  if (!member) return;
  document.getElementById('memberModalTitle').textContent = 'Edit Team Member';
  document.getElementById('memberModalEditId').value = member.id;
  document.getElementById('memberModalNameInput').value = member.name;
  document.getElementById('memberModalDeptSelect').value = member.department_id;
  document.getElementById('memberModalRoleInput').value = member.role_title;
  document.getElementById('memberModalSaveBtn').textContent = 'Update Member';
  openModal('memberModal');
}

async function saveMemberRecord() {
  const id = document.getElementById('memberModalEditId').value;
  const name = document.getElementById('memberModalNameInput').value.trim();
  const department_id = document.getElementById('memberModalDeptSelect').value;
  const role_title = document.getElementById('memberModalRoleInput').value.trim();

  if (!name) {
    showToast('Please enter member name', 'error');
    return;
  }

  const endpoint = id ? `/api/team-members/${id}` : '/api/team-members';
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, department_id, role_title })
  });

  const json = await res.json();
  if (json.success) {
    closeModal('memberModal');
    showToast(id ? 'Team member updated!' : 'Team member added to directory!', 'success');
    await refreshData();
  }
}

function openAddAdminPasswordModal() {
  document.getElementById('adminPassModalTitle').textContent = 'Create Another Admin Passkey';
  document.getElementById('adminPassModalEditId').value = '';
  document.getElementById('adminPassModalNameInput').value = '';
  document.getElementById('adminPassModalPassLabel').textContent = 'New Admin Password';
  document.getElementById('adminPassModalPassInput').value = '';
  document.getElementById('adminPassModalPassHelp').style.display = 'none';
  document.getElementById('adminPassModalSaveBtn').textContent = 'Save Admin Passkey';

  // Check standard modules by default
  ['links', 'announcements', 'polls', 'bottlenecks', 'roster', 'departments', 'passwords'].forEach(mod => {
    const chk = document.getElementById('perm_' + mod);
    if (chk) chk.checked = mod !== 'passwords';
  });

  openModal('adminPasswordModal');
}

function openEditAdminPasswordModal(id) {
  const admin = adminPasswordsCache.find(a => a.id === id);
  if (!admin) return;

  document.getElementById('adminPassModalTitle').textContent = 'Edit Admin Passkey & Roles';
  document.getElementById('adminPassModalEditId').value = admin.id;
  document.getElementById('adminPassModalNameInput').value = admin.admin_name;
  document.getElementById('adminPassModalPassLabel').textContent = 'Reset Password (Optional)';
  document.getElementById('adminPassModalPassInput').value = '';
  document.getElementById('adminPassModalPassHelp').style.display = 'block';
  document.getElementById('adminPassModalSaveBtn').textContent = 'Update Admin Passkey';

  const isSuper = admin.permissions.includes('all');
  ['links', 'announcements', 'polls', 'bottlenecks', 'roster', 'departments', 'passwords'].forEach(mod => {
    const chk = document.getElementById('perm_' + mod);
    if (chk) chk.checked = isSuper || admin.permissions.includes(mod);
  });

  openModal('adminPasswordModal');
}

async function saveAdminPasswordRecord() {
  const editId = document.getElementById('adminPassModalEditId').value;
  const adminName = document.getElementById('adminPassModalNameInput').value.trim();
  const newPassword = document.getElementById('adminPassModalPassInput').value;

  if (!adminName) {
    showToast('Please enter admin name or role label', 'error');
    return;
  }

  if (!editId && (!newPassword || newPassword.length < 4)) {
    showToast('Password is required (min 4 characters)', 'error');
    return;
  }

  // Gather checked permissions
  const perms = [];
  ['links', 'announcements', 'polls', 'bottlenecks', 'roster', 'departments', 'passwords'].forEach(mod => {
    const chk = document.getElementById('perm_' + mod);
    if (chk && chk.checked) perms.push(mod);
  });
  if (perms.length === 7) perms.push('all');

  const endpoint = editId ? `/api/admin/passwords/${editId}` : '/api/admin/passwords';
  const method = editId ? 'PUT' : 'POST';

  try {
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminName, newPassword, permissions: perms })
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      showToast(json.error || 'Failed to save admin passkey', 'error');
      return;
    }

    closeModal('adminPasswordModal');
    showToast(json.message || 'Admin passkey saved successfully!', 'success');
    await renderAdminPasswordsTable();
  } catch (err) {
    showToast('Network error while saving admin passkey', 'error');
  }
}

function openStartPollModal() {
  openModal('startPollModal');
}

async function saveStartPollRecord() {
  const title = document.getElementById('pollModalTitleInput').value.trim();
  const description = document.getElementById('pollModalDescInput').value.trim();
  if (!title) {
    showToast('Poll title is required', 'error');
    return;
  }

  const res = await fetch('/api/polls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description })
  });

  const json = await res.json();
  if (json.success) {
    closeModal('startPollModal');
    showToast('New innovation poll launched!', 'success');
    await refreshData();
  }
}

function openAddDepartmentModal() {
  document.getElementById('deptModalTitle').textContent = 'Add Department';
  document.getElementById('deptModalEditId').value = '';
  document.getElementById('deptModalNameInput').value = '';
  document.getElementById('deptModalCodeInput').value = '';
  document.getElementById('deptModalIconInput').value = '🏢';
  document.getElementById('deptModalColorInput').value = '#2A6FA8';
  document.getElementById('deptModalSaveBtn').textContent = 'Add Department';
  openModal('departmentModal');
}

function openEditDepartmentModal(id) {
  const dept = DATA.departments.find(d => d.id === id);
  if (!dept) return;
  document.getElementById('deptModalTitle').textContent = 'Edit Department';
  document.getElementById('deptModalEditId').value = dept.id;
  document.getElementById('deptModalNameInput').value = dept.name;
  document.getElementById('deptModalCodeInput').value = dept.code;
  document.getElementById('deptModalIconInput').value = dept.icon || '🏢';
  document.getElementById('deptModalColorInput').value = dept.color || '#2A6FA8';
  document.getElementById('deptModalSaveBtn').textContent = 'Update Department';
  openModal('departmentModal');
}

async function saveDepartmentRecord() {
  const id = document.getElementById('deptModalEditId').value;
  const name = document.getElementById('deptModalNameInput').value.trim();
  const code = document.getElementById('deptModalCodeInput').value.trim();
  const icon = document.getElementById('deptModalIconInput').value.trim();
  const color = document.getElementById('deptModalColorInput').value;

  if (!name) {
    showToast('Department name is required', 'error');
    return;
  }

  const endpoint = id ? `/api/departments/${id}` : '/api/departments';
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, code, icon, color })
  });

  const json = await res.json();
  if (json.success) {
    closeModal('departmentModal');
    showToast(id ? 'Department updated!' : 'Department created!', 'success');
    await refreshData();
  } else {
    showToast(json.error || 'Failed to save department', 'error');
  }
}

async function deleteDepartment(id) {
  if (!confirm('Are you sure you want to delete this department?')) return;
  const res = await fetch(`/api/departments/${id}`, { method: 'DELETE' });
  const json = await res.json();
  if (json.success) {
    showToast('Department deleted', 'success');
    await refreshData();
  } else {
    showToast(json.error || 'Cannot delete department', 'error');
  }
}

// ── HELPERS & UTILS ───────────────────────────────────────────
function populateDropdowns() {
  // Department selects in modals
  const deptOptions = DATA.departments.map(d => `<option value="${d.id}">${d.icon} ${esc(d.name)}</option>`).join('');

  const selects = ['ideaModalDeptSelect', 'hurdleModalDeptSelect', 'memberModalDeptSelect'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = deptOptions;
  });

  const linkDeptSelect = document.getElementById('linkModalDeptSelect');
  if (linkDeptSelect) {
    linkDeptSelect.innerHTML = `<option value="">🏢 Company-Wide (All)</option>` + deptOptions;
  }

  const announceDeptSelect = document.getElementById('announceModalDeptSelect');
  if (announceDeptSelect) {
    announceDeptSelect.innerHTML = `<option value="">Company-Wide (All)</option>` + deptOptions;
  }

  // Bottlenecks select in idea modal
  const btnSelect = document.getElementById('ideaModalBottleneckSelect');
  if (btnSelect) {
    btnSelect.innerHTML = `<option value="">None (Independent Idea)</option>` +
      DATA.bottlenecks.map(b => `<option value="${b.id}">${b.severity === 'Critical' ? '🔴' : '🟠'} ${esc(b.title)} (${esc(b.department_name)})</option>`).join('');
  }
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

let toastTimer;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, 3200);
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shortUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return url;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Close modals when clicking backdrop or pressing Escape
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }
});

// ── SUBMITTER DROPDOWN POPULATOR ──────────────────────────────
function populateSubmitterSelect(selectId, defaultName) {
  const el = document.getElementById(selectId);
  if (!el) return;

  const options = DATA.teamMembers.map(m => {
    const isSelected = defaultName && m.name.toLowerCase().trim() === defaultName.toLowerCase().trim();
    return `<option value="${esc(m.name)}" data-dept="${m.department_id}" data-deptname="${esc(m.department_name)}" ${isSelected ? 'selected' : ''}>${esc(m.name)} (${esc(m.department_name)} - ${esc(m.role_title)})</option>`;
  }).join('');

  el.innerHTML = `<option value="">-- Choose From Directory --</option>` + options;
}

// ── 10. APPRECIATION ENGINE & CELEBRATION MODAL ───────────────
let currentCelebrationIdea = null;

function triggerCelebration(ideaTitle, authorName, deptName, celebrationType) {
  currentCelebrationIdea = { ideaTitle, authorName, deptName, celebrationType };

  const badgeEl = document.getElementById('appreciationBadge');
  const titleEl = document.getElementById('appreciationTitle');
  const msgEl = document.getElementById('appreciationMessage');
  const ideaTitleEl = document.getElementById('appreciationIdeaTitle');
  const authorEl = document.getElementById('appreciationAuthor');
  const deptEl = document.getElementById('appreciationDept');

  if (badgeEl) badgeEl.textContent = celebrationType || 'INNOVATION EXCELLENCE';
  if (titleEl) {
    if (celebrationType === 'SELECTED FOR IMPLEMENTATION') {
      titleEl.textContent = '🎯 Selected for Implementation!';
    } else if (celebrationType === 'DEPARTMENT BEST CHOICE') {
      titleEl.textContent = '🏆 Department Choice Winner!';
    } else {
      titleEl.textContent = '🎉 Outstanding Contribution!';
    }
  }
  if (msgEl) {
    msgEl.textContent = celebrationType === 'SELECTED FOR IMPLEMENTATION'
      ? 'Executive leadership has chosen this initiative to be turned into an active workflow!'
      : 'Congratulations to the team for driving measurable progress and excellence!';
  }
  if (ideaTitleEl) ideaTitleEl.textContent = ideaTitle;
  if (authorEl) authorEl.textContent = authorName;
  if (deptEl) deptEl.textContent = deptName;

  openModal('appreciationModal');
  launchConfetti();
}

async function sendKudosClap(emoji) {
  if (!currentCelebrationIdea) return;
  const message = `${emoji} Huge kudos to ${currentCelebrationIdea.authorName} (${currentCelebrationIdea.deptName}) for "${currentCelebrationIdea.ideaTitle}"! #kudos #innovation`;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_name: currentUser.name || 'Team Member',
        sender_department_id: currentUser.department_id || 1,
        message
      })
    });
    const json = await res.json();
    if (json.success) {
      DATA.chat.push(json.message);
      renderChat();
      showToast(`${emoji} Kudos posted to Team Chat!`, 'success');
      closeModal('appreciationModal');
    }
  } catch (err) {
    showToast('Sent kudos!', 'success');
  }
}

// Pure HTML5 Canvas Confetti Burst
let confettiAnimId = null;
function launchConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;

  canvas.width = parent.clientWidth || 440;
  canvas.height = parent.clientHeight || 420;

  const colors = ['#F59E0B', '#14B8A6', '#2A6FA8', '#EC4899', '#8B5CF6', '#10B981', '#F97316'];
  const confettiCount = 75;
  const confetti = [];

  for (let i = 0; i < confettiCount; i++) {
    confetti.push({
      x: Math.random() * canvas.width,
      y: Math.random() * (canvas.height * 0.4),
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedX: (Math.random() - 0.5) * 6,
      speedY: Math.random() * 3 + 2,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 8,
      opacity: 1
    });
  }

  if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
  const startTime = Date.now();

  function animate() {
    const elapsed = Date.now() - startTime;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let alive = 0;
    confetti.forEach(c => {
      c.x += c.speedX;
      c.y += c.speedY;
      c.rotation += c.rotationSpeed;
      if (elapsed > 2000) {
        c.opacity = Math.max(0, 1 - (elapsed - 2000) / 1500);
      }

      if (c.opacity > 0 && c.y < canvas.height + 20) {
        alive++;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate((c.rotation * Math.PI) / 180);
        ctx.globalAlpha = c.opacity;
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.6);
        ctx.restore();
      }
    });

    if (alive > 0 && elapsed < 3500) {
      confettiAnimId = requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  animate();
}
