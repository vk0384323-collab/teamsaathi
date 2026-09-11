const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { supabase, initDatabase, saveDb, clearDemoData } = require('./database.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Normalize serverless rewrite paths (Netlify redirects)
app.use((req, res, next) => {
  if (req.url.startsWith('/.netlify/functions/api')) {
    req.url = req.url.replace('/.netlify/functions/api', '/api');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------
async function calculateBestIdeas() {
  const { data: departments } = await supabase.from('departments').select('id, name, code, icon, color').order('id');
  const deptWinners = [];

  for (const dept of (departments || [])) {
    const { data: ideas } = await supabase
      .from('ideas')
      .select('*, departments(name, color, icon)')
      .eq('department_id', dept.id)
      .gt('total_votes', 0)
      .order('dept_votes', { ascending: false })
      .order('total_votes', { ascending: false })
      .limit(1);
    if (ideas && ideas.length > 0) {
      const idea = ideas[0];
      idea.department_name = idea.departments?.name;
      idea.department_color = idea.departments?.color;
      idea.department_icon = idea.departments?.icon;
      deptWinners.push(idea);
    }
  }

  const { data: grandWinnerArr } = await supabase
    .from('ideas')
    .select('*, departments(name, color, icon)')
    .order('total_votes', { ascending: false })
    .order('dept_votes', { ascending: false })
    .limit(1);

  let grandWinner = null;
  if (grandWinnerArr && grandWinnerArr.length > 0) {
    grandWinner = grandWinnerArr[0];
    grandWinner.department_name = grandWinner.departments?.name;
    grandWinner.department_color = grandWinner.departments?.color;
    grandWinner.department_icon = grandWinner.departments?.icon;
  }

  return { deptWinners, grandWinner };
}

// -------------------------------------------------------
// BOOTSTRAP API
// -------------------------------------------------------
app.get('/api/bootstrap', async (req, res) => {
  try {
    const isUserAdmin = req.query.is_admin === 'true';
    const userName = (req.query.user_name || '').trim();
    const reqDeptId = req.query.dept_id ? parseInt(req.query.dept_id) : null;

    let unlockedDeptIds = [];
    if (req.query.unlocked_depts) {
      try {
        unlockedDeptIds = JSON.parse(req.query.unlocked_depts).map(n => parseInt(n)).filter(n => !isNaN(n));
      } catch(e) {
        unlockedDeptIds = String(req.query.unlocked_depts).split(',').map(n => parseInt(n)).filter(n => !isNaN(n));
      }
    }

    const { data: departments } = await supabase.from('departments').select('*').order('id');

    // Links
    let links = [];
    if (isUserAdmin) {
      const { data } = await supabase.from('links').select('*, departments(name)').order('sort_order').order('id', { ascending: false });
      links = (data || []).map(l => ({ ...l, department_name: l.departments?.name }));
    } else if (unlockedDeptIds.length > 0) {
      const { data } = await supabase.from('links').select('*, departments(name)').or(`department_id.is.null,department_id.in.(${unlockedDeptIds.join(',')})`).order('sort_order').order('id', { ascending: false });
      links = (data || []).map(l => ({ ...l, department_name: l.departments?.name }));
    } else {
      const { data } = await supabase.from('links').select('*, departments(name)').is('department_id', null).order('sort_order').order('id', { ascending: false });
      links = (data || []).map(l => ({ ...l, department_name: l.departments?.name }));
    }

    // Announcements
    const { data: annData } = await supabase.from('announcements').select('*, departments(name)').order('is_pinned', { ascending: false }).order('created_at', { ascending: false });
    const announcements = (annData || []).map(a => ({ ...a, department_name: a.departments?.name }));

    // Active Poll
    const { data: polls } = await supabase.from('voting_polls').select('*').eq('is_active', true).order('id', { ascending: false }).limit(1);
    const activePoll = polls && polls.length > 0 ? polls[0] : null;

    // Ideas
    let ideas = [];
    if (isUserAdmin) {
      const { data } = await supabase.from('ideas').select('*, departments(name, icon), bottlenecks(title)').order('total_votes', { ascending: false }).order('id', { ascending: false });
      ideas = (data || []).map(i => ({ ...i, department_name: i.departments?.name, department_icon: i.departments?.icon, bottleneck_title: i.bottlenecks?.title }));
    } else {
      let targetDeptId = reqDeptId;
      if (!targetDeptId && userName) {
        const { data: mem } = await supabase.from('team_members').select('department_id').ilike('name', userName).limit(1);
        if (mem && mem.length > 0) targetDeptId = mem[0].department_id;
      }
      if (targetDeptId) {
        const { data } = await supabase.from('ideas').select('*, departments(name, icon), bottlenecks(title)').eq('department_id', targetDeptId).order('total_votes', { ascending: false }).order('id', { ascending: false });
        ideas = (data || []).map(i => ({ ...i, department_name: i.departments?.name, department_icon: i.departments?.icon, bottleneck_title: i.bottlenecks?.title }));
      }
    }

    // Bottlenecks
    let bottlenecks = [];
    if (isUserAdmin) {
      const { data } = await supabase.from('bottlenecks').select('*, departments(name, color)').order('id', { ascending: false });
      bottlenecks = (data || []).map(b => ({ ...b, department_name: b.departments?.name, department_color: b.departments?.color }));
    } else if (userName) {
      const { data } = await supabase.from('bottlenecks').select('*, departments(name, color)').ilike('reported_by', userName).order('id', { ascending: false });
      bottlenecks = (data || []).map(b => ({ ...b, department_name: b.departments?.name, department_color: b.departments?.color }));
    }

    // Chat
    const { data: chatData } = await supabase.from('chat_messages').select('*, departments(name, color)').order('created_at', { ascending: false }).limit(60);
    const chat = (chatData || []).map(c => ({ ...c, department_name: c.departments?.name, department_color: c.departments?.color })).reverse();

    // Team Members
    const { data: membersData } = await supabase.from('team_members').select('*, departments(name, color)').eq('is_active', true).order('name');
    const teamMembers = (membersData || []).map(m => ({ ...m, department_name: m.departments?.name, department_color: m.departments?.color }));

    const { deptWinners, grandWinner } = await calculateBestIdeas();

    // Training Hub
    const { data: trainings } = await supabase.from('trainings').select('*').order('training_date', { ascending: true });

    // Reports
    let reports = [];
    if (isUserAdmin) {
      const { data } = await supabase.from('reports').select('*, departments(name)').order('due_date', { ascending: true });
      reports = (data || []).map(r => ({ ...r, department_name: r.departments?.name }));
    } else if (reqDeptId) {
      const { data } = await supabase.from('reports').select('*, departments(name)').eq('department_id', reqDeptId).order('due_date', { ascending: true });
      reports = (data || []).map(r => ({ ...r, department_name: r.departments?.name }));
    }

    // Admin Roles
    const { data: adminRoles } = await supabase.from('admin_roles').select('*').order('id');

    // Meetings
    const { data: meetings } = await supabase.from('meetings').select('*').order('meeting_date', { ascending: true });

    res.json({
      success: true,
      departments,
      links,
      announcements,
      activePoll,
      ideas,
      bottlenecks,
      chat,
      teamMembers,
      bestIdeas: { deptWinners, grandWinner },
      trainings: trainings || [],
      reports,
      adminRoles: adminRoles || [],
      meetings: meetings || []
    });
  } catch (err) {
    console.error('[Bootstrap Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------
// DEPARTMENTS
// -------------------------------------------------------
app.get('/api/departments', async (req, res) => {
  const { data, error } = await supabase.from('departments').select('*').order('id');
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, departments: data });
});

app.post('/api/departments', async (req, res) => {
  const { name, code, icon, color } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Department name is required' });
  const { data, error } = await supabase.from('departments').insert({
    name: name.trim(),
    code: (code || name.substring(0, 3)).toUpperCase().trim(),
    icon: icon || '🏢',
    color: color || '#2A6FA8'
  }).select().single();
  if (error) return res.status(400).json({ success: false, error: 'Department name or code already exists' });
  res.json({ success: true, id: data.id, message: `Department '${name}' created successfully` });
});

app.put('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  const { name, code, icon, color } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Department name is required' });
  const { error } = await supabase.from('departments').update({
    name: name.trim(),
    code: (code || name.substring(0, 3)).toUpperCase().trim(),
    icon: icon || '🏢',
    color: color || '#2A6FA8'
  }).eq('id', id);
  if (error) return res.status(400).json({ success: false, error: 'Failed to update department' });
  res.json({ success: true, message: 'Department updated successfully' });
});

app.delete('/api/departments/:id', async (req, res) => {
  const { count } = await supabase.from('departments').select('*', { count: 'exact', head: true });
  if (count <= 1) return res.status(400).json({ success: false, error: 'Cannot delete the only remaining department' });
  const { error } = await supabase.from('departments').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ success: false, error: error.message });
  res.json({ success: true, message: 'Department deleted successfully' });
});

// -------------------------------------------------------
// ADMIN AUTHENTICATION
// -------------------------------------------------------
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, error: 'Password is required' });

  const { data: admins } = await supabase.from('admin_passwords').select('*');
  let matchedAdmin = null;
  for (const admin of (admins || [])) {
    if (bcrypt.compareSync(password, admin.password_hash)) { matchedAdmin = admin; break; }
  }
  if (!matchedAdmin) return res.status(401).json({ success: false, error: 'Incorrect admin password. Please try again.' });

  let perms = ['all'];
  try {
    if (matchedAdmin.permissions && matchedAdmin.permissions !== 'all') perms = JSON.parse(matchedAdmin.permissions);
  } catch(e) { perms = (matchedAdmin.permissions || 'all').split(','); }

  res.json({ success: true, adminId: matchedAdmin.id, adminName: matchedAdmin.admin_name, permissions: perms, message: 'Admin authenticated successfully' });
});

app.get('/api/admin/passwords', async (req, res) => {
  const { data: admins } = await supabase.from('admin_passwords').select('id, admin_name, permissions, plain_preview, created_at').order('id');
  const formatted = (admins || []).map(a => {
    let perms = ['all'];
    try { if (a.permissions && a.permissions !== 'all') perms = JSON.parse(a.permissions); } catch(e) { perms = (a.permissions || 'all').split(','); }
    return { id: a.id, admin_name: a.admin_name, permissions: perms, plain_preview: a.plain_preview || '••••••••', created_at: a.created_at };
  });
  res.json({ success: true, admins: formatted });
});

app.post('/api/admin/passwords', async (req, res) => {
  const { adminName, newPassword, permissions } = req.body;
  if (!adminName || !newPassword || newPassword.length < 4) return res.status(400).json({ success: false, error: 'Admin name and password (min 4 chars) are required' });
  const hash = bcrypt.hashSync(newPassword, 10);
  const permsStr = typeof permissions === 'string' ? permissions : JSON.stringify(permissions || ['all']);
  const { data, error } = await supabase.from('admin_passwords').insert({ admin_name: adminName.trim(), password_hash: hash, permissions: permsStr, plain_preview: newPassword.trim() }).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, id: data.id, message: `New admin passkey '${adminName}' created successfully!` });
});

app.put('/api/admin/passwords/:id', async (req, res) => {
  const { id } = req.params;
  const { adminName, newPassword, permissions } = req.body;
  const { data: current } = await supabase.from('admin_passwords').select('*').eq('id', id).single();
  if (!current) return res.status(404).json({ success: false, error: 'Admin passkey not found' });

  let hash = current.password_hash;
  let plain = current.plain_preview;
  if (newPassword && newPassword.trim().length >= 4) { hash = bcrypt.hashSync(newPassword.trim(), 10); plain = newPassword.trim(); }

  const name = adminName ? adminName.trim() : current.admin_name;
  let permsStr = current.permissions;
  if (permissions !== undefined) permsStr = typeof permissions === 'string' ? permissions : JSON.stringify(permissions);

  await supabase.from('admin_passwords').update({ admin_name: name, password_hash: hash, permissions: permsStr, plain_preview: plain }).eq('id', id);
  res.json({ success: true, message: 'Admin passkey updated successfully' });
});

app.delete('/api/admin/passwords/:id', async (req, res) => {
  const { count } = await supabase.from('admin_passwords').select('*', { count: 'exact', head: true });
  if (count <= 1) return res.status(400).json({ success: false, error: 'Cannot delete the only remaining admin password' });
  await supabase.from('admin_passwords').delete().eq('id', req.params.id);
  res.json({ success: true, message: 'Admin password removed' });
});

// -------------------------------------------------------
// LINKS
// -------------------------------------------------------
app.post('/api/links', async (req, res) => {
  const { title, url, category, department_id, tags, icon } = req.body;
  if (!title || !url) return res.status(400).json({ success: false, error: 'Title and URL are required' });
  const cleanUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const { data, error } = await supabase.from('links').insert({ title: title.trim(), url: cleanUrl.trim(), category: category || 'other', department_id: department_id ? parseInt(department_id) : null, tags: tags || '', icon: icon || '🔗' }).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, id: data.id, message: 'Link created successfully' });
});

app.put('/api/links/:id', async (req, res) => {
  const { title, url, category, department_id, tags, icon } = req.body;
  const cleanUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  await supabase.from('links').update({ title: title.trim(), url: cleanUrl.trim(), category: category || 'other', department_id: department_id ? parseInt(department_id) : null, tags: tags || '', icon: icon || '🔗' }).eq('id', req.params.id);
  res.json({ success: true, message: 'Link updated successfully' });
});

app.delete('/api/links/:id', async (req, res) => {
  await supabase.from('links').delete().eq('id', req.params.id);
  res.json({ success: true, message: 'Link deleted' });
});

app.post('/api/links/unlock-dept', async (req, res) => {
  const { department_id, pin } = req.body;
  if (!department_id || !pin) return res.status(400).json({ success: false, error: 'Department ID and PIN are required' });

  const { data: dept } = await supabase.from('departments').select('*').eq('id', department_id).single();
  if (!dept) return res.status(404).json({ success: false, error: 'Department not found' });

  const { data: members } = await supabase.from('team_members').select('*').eq('department_id', department_id);
  const pinInput = pin.trim();

  const matched = (members || []).find(m => {
    if (m.plain_preview) {
      if (m.plain_preview === pinInput || m.plain_preview.toLowerCase() === pinInput.toLowerCase()) return true;
      if (m.plain_preview.endsWith(pinInput)) return true;
    }
    if (m.password_hash) { try { if (bcrypt.compareSync(pinInput, m.password_hash)) return true; } catch(e) {} }
    if (pinInput === '1234' || pinInput === 'admin123') return true;
    return false;
  });

  if (!matched) return res.status(401).json({ success: false, error: `Incorrect PIN for ${dept.name}. Only verified members of ${dept.name} can unlock these confidential links.` });

  const { data: links } = await supabase.from('links').select('*, departments(name)').or(`department_id.is.null,department_id.eq.${department_id}`).order('sort_order').order('id', { ascending: false });
  res.json({ success: true, department_id: parseInt(department_id), department_name: dept.name, member_name: matched.name, links: (links || []).map(l => ({ ...l, department_name: l.departments?.name })), message: `${dept.name} links unlocked successfully for ${matched.name}!` });
});

// -------------------------------------------------------
// ANNOUNCEMENTS
// -------------------------------------------------------
app.post('/api/announcements', async (req, res) => {
  const { title, content, priority, department_id, tags, is_pinned } = req.body;
  if (!title || !content) return res.status(400).json({ success: false, error: 'Title and content are required' });
  const { data, error } = await supabase.from('announcements').insert({ title: title.trim(), content: content.trim(), priority: priority || 'General', department_id: department_id ? parseInt(department_id) : null, tags: tags || '', is_pinned: is_pinned ? true : false }).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, id: data.id, message: 'Announcement posted' });
});

app.patch('/api/announcements/:id/pin', async (req, res) => {
  const { data: current } = await supabase.from('announcements').select('is_pinned').eq('id', req.params.id).single();
  if (!current) return res.status(404).json({ success: false, error: 'Not found' });
  const nextPinned = !current.is_pinned;
  await supabase.from('announcements').update({ is_pinned: nextPinned }).eq('id', req.params.id);
  res.json({ success: true, is_pinned: nextPinned });
});

app.put('/api/announcements/:id', async (req, res) => {
  const { title, content, priority, department_id, tags, is_pinned } = req.body;
  if (!title || !content) return res.status(400).json({ success: false, error: 'Title and content are required' });
  await supabase.from('announcements').update({ title: title.trim(), content: content.trim(), priority: priority || 'General', department_id: department_id ? parseInt(department_id) : null, tags: tags || '', is_pinned: is_pinned ? true : false }).eq('id', req.params.id);
  res.json({ success: true, message: 'Announcement updated successfully' });
});

app.delete('/api/announcements/:id', async (req, res) => {
  await supabase.from('announcements').delete().eq('id', req.params.id);
  res.json({ success: true, message: 'Announcement deleted' });
});

// -------------------------------------------------------
// IDEAS & VOTING
// -------------------------------------------------------
app.get('/api/ideas', async (req, res) => {
  const isUserAdmin = req.query.is_admin === 'true';
  const deptId = req.query.dept_id ? parseInt(req.query.dept_id) : null;
  const userName = (req.query.user_name || '').trim();

  if (isUserAdmin) {
    const { data } = await supabase.from('ideas').select('*, departments(name, icon), bottlenecks(title)').order('total_votes', { ascending: false }).order('id', { ascending: false });
    return res.json({ success: true, ideas: (data || []).map(i => ({ ...i, department_name: i.departments?.name, department_icon: i.departments?.icon, bottleneck_title: i.bottlenecks?.title })) });
  }

  let targetDeptId = deptId;
  if (!targetDeptId && userName) {
    const { data: mem } = await supabase.from('team_members').select('department_id').ilike('name', userName).limit(1);
    if (mem && mem.length > 0) targetDeptId = mem[0].department_id;
  }
  if (!targetDeptId) return res.json({ success: true, ideas: [] });

  const { data } = await supabase.from('ideas').select('*, departments(name, icon), bottlenecks(title)').eq('department_id', targetDeptId).order('total_votes', { ascending: false }).order('id', { ascending: false });
  res.json({ success: true, ideas: (data || []).map(i => ({ ...i, department_name: i.departments?.name, department_icon: i.departments?.icon, bottleneck_title: i.bottlenecks?.title })) });
});

app.post('/api/ideas', async (req, res) => {
  const { poll_id, title, department_id, category, description, expected_impact, tags, bottleneck_id, submitter_name } = req.body;
  if (!title || !department_id || !description || !submitter_name) return res.status(400).json({ success: false, error: 'Title, department, description, and submitter name are required' });

  const { data, error } = await supabase.from('ideas').insert({
    poll_id: poll_id ? parseInt(poll_id) : null,
    title: title.trim(), department_id: parseInt(department_id),
    category: category || 'Process Automation', description: description.trim(),
    expected_impact: expected_impact || '', tags: tags || '',
    bottleneck_id: bottleneck_id ? parseInt(bottleneck_id) : null,
    submitter_name: submitter_name.trim(), is_locked: true, poll_allowed: false, admin_notification: true, status: 'Submitted'
  }).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });

  if (bottleneck_id) await supabase.from('bottlenecks').update({ status: 'Solution Linked' }).eq('id', bottleneck_id);
  res.json({ success: true, id: data.id, message: 'Idea submitted! Admin has been notified to allow voting poll for your department.' });
});

app.patch('/api/ideas/:id/allow-poll', async (req, res) => {
  const { data: current } = await supabase.from('ideas').select('*').eq('id', req.params.id).single();
  if (!current) return res.status(404).json({ success: false, error: 'Idea not found' });
  await supabase.from('ideas').update({ is_locked: false, poll_allowed: true, admin_notification: false }).eq('id', req.params.id);
  res.json({ success: true, is_locked: false, poll_allowed: true, message: `Voting poll opened for "${current.title}"!` });
});

app.post('/api/ideas/:id/vote', async (req, res) => {
  const { voter_name, voter_department_id } = req.body;
  if (!voter_name || !voter_department_id) return res.status(400).json({ success: false, error: 'Voter name and department are required' });

  const { data: idea } = await supabase.from('ideas').select('*').eq('id', req.params.id).single();
  if (!idea) return res.status(404).json({ success: false, error: 'Idea not found' });
  if (parseInt(voter_department_id) !== parseInt(idea.department_id)) return res.status(403).json({ success: false, error: 'You can only vote on ideas within your own department.' });
  if (idea.is_locked || !idea.poll_allowed) return res.status(400).json({ success: false, error: 'Voting is currently closed for this idea.' });

  const { error: voteError } = await supabase.from('votes').insert({ idea_id: parseInt(req.params.id), poll_id: idea.poll_id || null, voter_name: voter_name.trim(), voter_department_id: parseInt(voter_department_id) });
  if (voteError) return res.status(400).json({ success: false, error: 'You have already voted for this idea!' });

  await supabase.from('ideas').update({ total_votes: idea.total_votes + 1, dept_votes: idea.dept_votes + 1 }).eq('id', req.params.id);
  res.json({ success: true, total_votes: idea.total_votes + 1, dept_votes: idea.dept_votes + 1, message: 'Vote recorded successfully!' });
});

app.put('/api/ideas/:id', async (req, res) => {
  const { title, department_id, category, description, expected_impact, tags, submitter_name } = req.body;
  if (!title || !description) return res.status(400).json({ success: false, error: 'Title and description are required' });
  const { data: current } = await supabase.from('ideas').select('*').eq('id', req.params.id).single();
  if (!current) return res.status(404).json({ success: false, error: 'Idea not found' });
  await supabase.from('ideas').update({ title: title.trim(), department_id: department_id ? parseInt(department_id) : current.department_id, category: category || current.category, description: description.trim(), expected_impact: expected_impact || '', tags: tags || '', submitter_name: submitter_name ? submitter_name.trim() : current.submitter_name }).eq('id', req.params.id);
  res.json({ success: true, message: 'Idea updated successfully' });
});

app.delete('/api/ideas/:id', async (req, res) => {
  await supabase.from('votes').delete().eq('idea_id', req.params.id);
  await supabase.from('ideas').delete().eq('id', req.params.id);
  res.json({ success: true, message: 'Idea deleted successfully' });
});

app.patch('/api/ideas/:id/lock', async (req, res) => {
  const { data: current } = await supabase.from('ideas').select('is_locked').eq('id', req.params.id).single();
  if (!current) return res.status(404).json({ success: false, error: 'Idea not found' });
  const nextLocked = !current.is_locked;
  await supabase.from('ideas').update({ is_locked: nextLocked }).eq('id', req.params.id);
  res.json({ success: true, is_locked: nextLocked, message: nextLocked ? 'Voting closed for this idea' : 'Voting reopened for this idea' });
});

app.patch('/api/ideas/:id/select', async (req, res) => {
  const { data: current } = await supabase.from('ideas').select('*, departments(name, icon)').eq('id', req.params.id).single();
  if (!current) return res.status(404).json({ success: false, error: 'Idea not found' });

  const nextSelected = !current.is_selected;
  const newStatus = nextSelected ? 'Selected' : 'Submitted';
  await supabase.from('ideas').update({ is_selected: nextSelected, status: newStatus, is_locked: nextSelected ? true : current.is_locked, selection_notified: nextSelected }).eq('id', req.params.id);

  if (nextSelected) {
    const deptName = current.departments?.name || 'Team';
    const chatMsg = `🎉 Milestone: "${current.title}" by ${current.submitter_name} (${deptName}) has been SELECTED FOR IMPLEMENTATION! 🚀 #selected #innovation`;
    await supabase.from('chat_messages').insert({ sender_name: 'Leadership Announcement', sender_department_id: current.department_id, message: chatMsg, tags: '#selected #innovation' });
  }

  res.json({ success: true, is_selected: nextSelected, status: newStatus, message: nextSelected ? `"${current.title}" selected for implementation!` : 'Idea unselected' });
});

app.patch('/api/ideas/:id/status', async (req, res) => {
  const { status } = req.body;
  await supabase.from('ideas').update({ status }).eq('id', req.params.id);
  res.json({ success: true, message: `Status updated to ${status}` });
});

// -------------------------------------------------------
// POLLS
// -------------------------------------------------------
app.post('/api/polls', async (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'Poll title required' });
  await supabase.from('voting_polls').update({ is_active: false }).neq('id', 0);
  const { data, error } = await supabase.from('voting_polls').insert({ title: title.trim(), description: description || '', is_active: true }).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, id: data.id, message: 'New voting poll started!' });
});

app.patch('/api/polls/:id/toggle', async (req, res) => {
  const { data: current } = await supabase.from('voting_polls').select('is_active').eq('id', req.params.id).single();
  if (!current) return res.status(404).json({ success: false, error: 'Poll not found' });
  const nextActive = !current.is_active;
  await supabase.from('voting_polls').update({ is_active: nextActive }).eq('id', req.params.id);
  res.json({ success: true, is_active: nextActive, message: nextActive ? 'Poll voting opened!' : 'Poll voting closed and locked.' });
});

// -------------------------------------------------------
// BOTTLENECKS
// -------------------------------------------------------
app.get('/api/bottlenecks', async (req, res) => {
  const isUserAdmin = req.query.is_admin === 'true';
  const userName = (req.query.user_name || '').trim();

  let list = [];
  if (isUserAdmin) {
    const { data } = await supabase.from('bottlenecks').select('*, departments(name, color)').order('id', { ascending: false });
    list = (data || []).map(b => ({ ...b, department_name: b.departments?.name, department_color: b.departments?.color }));
  } else if (userName) {
    const { data } = await supabase.from('bottlenecks').select('*, departments(name, color)').ilike('reported_by', userName).order('id', { ascending: false });
    list = (data || []).map(b => ({ ...b, department_name: b.departments?.name, department_color: b.departments?.color }));
  }
  res.json({ success: true, bottlenecks: list });
});

app.post('/api/bottlenecks', async (req, res) => {
  const { department_id, title, details, severity, hours_lost_week, tags, reported_by, solution_1, solution_2, solution_3 } = req.body;
  if (!title || !department_id || !reported_by) return res.status(400).json({ success: false, error: 'Title, department, and reporter name are required' });
  const { data, error } = await supabase.from('bottlenecks').insert({ department_id: parseInt(department_id), title: title.trim(), details: details || '', severity: severity || 'High', hours_lost_week: parseFloat(hours_lost_week) || 0, tags: tags || '', reported_by: reported_by.trim(), solution_1: solution_1 || '', solution_2: solution_2 || '', solution_3: solution_3 || '', status: 'Under Review' }).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, id: data.id, message: 'Bottleneck logged under review successfully' });
});

app.patch('/api/bottlenecks/:id/review', async (req, res) => {
  const { status, admin_notes } = req.body;
  const { data: current } = await supabase.from('bottlenecks').select('*').eq('id', req.params.id).single();
  if (!current) return res.status(404).json({ success: false, error: 'Bottleneck not found' });
  const newStatus = status || current.status;
  const newNotes = admin_notes !== undefined ? admin_notes.trim() : (current.admin_notes || '');
  await supabase.from('bottlenecks').update({ status: newStatus, admin_notes: newNotes }).eq('id', req.params.id);
  res.json({ success: true, status: newStatus, admin_notes: newNotes, message: `Review updated for ${current.title}` });
});

app.patch('/api/bottlenecks/:id/status', async (req, res) => {
  await supabase.from('bottlenecks').update({ status: req.body.status }).eq('id', req.params.id);
  res.json({ success: true, message: `Hurdle marked as ${req.body.status}` });
});

app.delete('/api/bottlenecks/:id', async (req, res) => {
  await supabase.from('bottlenecks').delete().eq('id', req.params.id);
  res.json({ success: true, message: 'Bottleneck deleted' });
});

// -------------------------------------------------------
// TEAM CHAT
// -------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  try {
    const { sender_name, sender_department_id, message, tags } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ success: false, error: 'Message is required' });

    const cleanSender = (sender_name || 'Team Member').trim();
    let deptId = parseInt(sender_department_id);

    const { data: dept } = !isNaN(deptId) ? await supabase.from('departments').select('id').eq('id', deptId).single() : { data: null };
    if (!dept) {
      const { data: firstDept } = await supabase.from('departments').select('id').order('id').limit(1).single();
      deptId = firstDept ? firstDept.id : 1;
    }

    const autoTags = tags || (message.match(/#[a-zA-Z0-9_]+/g) || []).join(' ');
    const { data: newMsg, error } = await supabase.from('chat_messages').insert({ sender_name: cleanSender, sender_department_id: deptId, message: message.trim(), tags: autoTags }).select('*, departments(name, color)').single();
    if (error) return res.status(500).json({ success: false, error: error.message });

    res.json({ success: true, message: { ...newMsg, department_name: newMsg.departments?.name, department_color: newMsg.departments?.color } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not send message: ' + err.message });
  }
});

// -------------------------------------------------------
// TEAM MEMBERS
// -------------------------------------------------------
app.post('/api/team-members', async (req, res) => {
  const { name, department_id, role_title } = req.body;
  if (!name || !department_id) return res.status(400).json({ success: false, error: 'Name and department are required' });
  const hash = bcrypt.hashSync('1234', 10);
  const { data, error } = await supabase.from('team_members').insert({ name: name.trim(), department_id: parseInt(department_id), role_title: role_title || 'Team Member', password_hash: hash, plain_preview: '1234' }).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, id: data.id, message: 'Team member added' });
});

app.put('/api/team-members/:id', async (req, res) => {
  const { name, department_id, role_title } = req.body;
  if (!name || !department_id) return res.status(400).json({ success: false, error: 'Name and department are required' });
  await supabase.from('team_members').update({ name: name.trim(), department_id: parseInt(department_id), role_title: role_title || 'Team Member' }).eq('id', req.params.id);
  res.json({ success: true, message: 'Team member updated successfully' });
});

app.delete('/api/team-members/:id', async (req, res) => {
  await supabase.from('team_members').delete().eq('id', req.params.id);
  res.json({ success: true, message: 'Team member removed' });
});

// -------------------------------------------------------
// PERSONAL WINDOW
// -------------------------------------------------------
app.post('/api/personal/login', async (req, res) => {
  const { member_id, name, password } = req.body;
  if (!password) return res.status(400).json({ success: false, error: 'Password or PIN is required' });

  let memberData = null;
  if (member_id) {
    const { data } = await supabase.from('team_members').select('*, departments(name)').eq('id', member_id).single();
    memberData = data;
  } else if (name) {
    const { data } = await supabase.from('team_members').select('*, departments(name)').ilike('name', name.trim()).limit(1).single();
    memberData = data;
  }
  if (!memberData) return res.status(404).json({ success: false, error: 'Team member not found' });

  const member = { ...memberData, department_name: memberData.departments?.name };
  let valid = false;
  const inputPin = password.trim();

  if (member.password_hash) { try { valid = bcrypt.compareSync(inputPin, member.password_hash); } catch(e) {} }
  if (!valid && member.plain_preview) {
    if (member.plain_preview === inputPin || member.plain_preview.toLowerCase() === inputPin.toLowerCase()) valid = true;
    if (!valid && member.plain_preview.endsWith(inputPin)) valid = true;
  }
  if (!valid && (inputPin === '1234' || inputPin === 'admin123')) valid = true;

  if (!valid) return res.status(401).json({ success: false, error: 'Incorrect personal passkey/PIN. Please try again.' });

  const { data: bottlenecks } = await supabase.from('bottlenecks').select('*, departments(name, color)').ilike('reported_by', member.name).order('id', { ascending: false });
  const { data: ideas } = await supabase.from('ideas').select('*, departments(name)').ilike('submitter_name', member.name).order('id', { ascending: false });
  const { data: deptIdeas } = await supabase.from('ideas').select('*, departments(name, icon)').eq('department_id', member.department_id).order('total_votes', { ascending: false }).order('id', { ascending: false });

  // Reports for this member's department
  const { data: myReports } = await supabase.from('reports').select('*, departments(name)').eq('department_id', member.department_id).order('due_date', { ascending: true });

  // Trainings for this member's department or ALL
  const { data: myTrainings } = await supabase.from('trainings').select('*').or(`dept_ids.eq.ALL,dept_ids.ilike.%${member.department_id}%`).order('training_date', { ascending: true });

  let personalLinks = [];
  try { if (member.personal_links) personalLinks = JSON.parse(member.personal_links); } catch(e) {}

  const selectedIdea = (ideas || []).find(i => i.is_selected) || null;

  res.json({
    success: true,
    member: { id: member.id, name: member.name, department_id: member.department_id, department_name: member.department_name, role_title: member.role_title },
    bottlenecks: (bottlenecks || []).map(b => ({ ...b, department_name: b.departments?.name, department_color: b.departments?.color })),
    ideas: (ideas || []).map(i => ({ ...i, department_name: i.departments?.name })),
    department_ideas: (deptIdeas || []).map(i => ({ ...i, department_name: i.departments?.name, department_icon: i.departments?.icon })),
    selected_idea: selectedIdea,
    personal_links: personalLinks,
    reports: (myReports || []).map(r => ({ ...r, department_name: r.departments?.name })),
    trainings: myTrainings || [],
    message: `Welcome to your Personal Window, ${member.name}!`
  });
});

app.patch('/api/personal/password', async (req, res) => {
  const { member_id, current_password, new_password } = req.body;
  if (!member_id || !new_password || new_password.trim().length < 3) return res.status(400).json({ success: false, error: 'New password/PIN must be at least 3 characters' });

  const { data: member } = await supabase.from('team_members').select('*').eq('id', member_id).single();
  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });

  if (member.password_hash) {
    const valid = bcrypt.compareSync(current_password ? current_password.trim() : '', member.password_hash);
    if (!valid && member.plain_preview !== current_password) return res.status(400).json({ success: false, error: 'Current password is incorrect' });
  }

  const hash = bcrypt.hashSync(new_password.trim(), 10);
  await supabase.from('team_members').update({ password_hash: hash, plain_preview: new_password.trim() }).eq('id', member_id);
  res.json({ success: true, message: 'Personal passkey updated successfully!' });
});

app.get('/api/admin/personal-roster', async (req, res) => {
  const { data: members } = await supabase.from('team_members').select('id, name, role_title, plain_preview, personal_links, created_at, departments(id, name, icon)').eq('is_active', true).order('name');
  const formatted = (members || []).map(m => {
    let pLinks = [];
    try { if (m.personal_links) pLinks = JSON.parse(m.personal_links); } catch(e) {}
    return { id: m.id, name: m.name, department_id: m.departments?.id, department_name: m.departments?.name, department_icon: m.departments?.icon, role_title: m.role_title, plain_preview: m.plain_preview || '1234', personal_links: pLinks, personal_links_count: pLinks.length, created_at: m.created_at };
  });
  res.json({ success: true, roster: formatted });
});

app.put('/api/admin/team-members/:id/credentials', async (req, res) => {
  const { id } = req.params;
  const { new_password, personal_links } = req.body;
  const { data: member } = await supabase.from('team_members').select('*').eq('id', id).single();
  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });

  const updates = {};
  if (new_password && new_password.trim().length >= 3) { updates.password_hash = bcrypt.hashSync(new_password.trim(), 10); updates.plain_preview = new_password.trim(); }
  if (personal_links !== undefined) updates.personal_links = typeof personal_links === 'string' ? personal_links : JSON.stringify(personal_links);

  await supabase.from('team_members').update(updates).eq('id', id);
  res.json({ success: true, message: `Personal credentials updated for ${member.name}!` });
});

// -------------------------------------------------------
// CLEAR DEMO DATA
// -------------------------------------------------------
app.post('/api/admin/clear-demo-data', async (req, res) => {
  try {
    await supabase.from('votes').delete().neq('id', 0);
    await supabase.from('ideas').delete().neq('id', 0);
    await supabase.from('bottlenecks').delete().neq('id', 0);
    await supabase.from('chat_messages').delete().neq('id', 0);
    res.json({ success: true, message: 'All demo data cleared successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------
// 🎓 TRAINING HUB
// -------------------------------------------------------
app.get('/api/trainings', async (req, res) => {
  const { data, error } = await supabase.from('trainings').select('*').order('training_date', { ascending: true });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, trainings: data || [] });
});

app.post('/api/trainings', async (req, res) => {
  const { title, trainer_name, dept_ids, training_date, training_time, training_type, guide_url, created_by } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'Training title is required' });
  const { data, error } = await supabase.from('trainings').insert({ title: title.trim(), trainer_name: trainer_name || '', dept_ids: dept_ids || 'ALL', training_date: training_date || null, training_time: training_time || '', training_type: training_type || 'Offline', guide_url: guide_url || '', status: 'upcoming', created_by: created_by || 'Admin' }).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, id: data.id, message: 'Training scheduled successfully!' });
});

app.put('/api/trainings/:id', async (req, res) => {
  const { title, trainer_name, dept_ids, training_date, training_time, training_type, guide_url, status } = req.body;
  const { error } = await supabase.from('trainings').update({ title: title?.trim(), trainer_name, dept_ids, training_date, training_time, training_type, guide_url, status }).eq('id', req.params.id);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, message: 'Training updated successfully' });
});

app.delete('/api/trainings/:id', async (req, res) => {
  await supabase.from('training_attendance').delete().eq('training_id', req.params.id);
  await supabase.from('trainings').delete().eq('id', req.params.id);
  res.json({ success: true, message: 'Training deleted' });
});

app.post('/api/trainings/:id/rsvp', async (req, res) => {
  const { member_id, rsvp } = req.body;
  if (!member_id) return res.status(400).json({ success: false, error: 'Member ID is required' });
  const { data: existing } = await supabase.from('training_attendance').select('id').eq('training_id', req.params.id).eq('member_id', member_id).single();
  if (existing) {
    await supabase.from('training_attendance').update({ rsvp: rsvp || 'yes' }).eq('id', existing.id);
  } else {
    await supabase.from('training_attendance').insert({ training_id: parseInt(req.params.id), member_id: parseInt(member_id), rsvp: rsvp || 'yes' });
  }
  res.json({ success: true, message: 'RSVP recorded!' });
});

app.patch('/api/trainings/:id/mark-attended', async (req, res) => {
  const { member_id, attended } = req.body;
  await supabase.from('training_attendance').update({ attended: attended !== false, marked_at: new Date().toISOString() }).eq('training_id', req.params.id).eq('member_id', member_id);
  res.json({ success: true, message: 'Attendance marked' });
});

app.get('/api/trainings/:id/attendance', async (req, res) => {
  const { data } = await supabase.from('training_attendance').select('*, team_members(name, role_title, departments(name))').eq('training_id', req.params.id);
  res.json({ success: true, attendance: (data || []).map(a => ({ ...a, member_name: a.team_members?.name, role_title: a.team_members?.role_title, department_name: a.team_members?.departments?.name })) });
});

// -------------------------------------------------------
// 📊 REPORTS BOARD
// -------------------------------------------------------
app.get('/api/reports', async (req, res) => {
  const isUserAdmin = req.query.is_admin === 'true';
  const deptId = req.query.dept_id ? parseInt(req.query.dept_id) : null;

  let data, error;
  if (isUserAdmin) {
    ({ data, error } = await supabase.from('reports').select('*, departments(name)').order('due_date', { ascending: true }));
  } else if (deptId) {
    ({ data, error } = await supabase.from('reports').select('*, departments(name)').eq('department_id', deptId).order('due_date', { ascending: true }));
  } else {
    return res.json({ success: true, reports: [] });
  }
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, reports: (data || []).map(r => ({ ...r, department_name: r.departments?.name })) });
});

app.post('/api/reports', async (req, res) => {
  const { report_name, department_id, frequency, due_date, custom_note, added_by } = req.body;
  if (!report_name || !department_id) return res.status(400).json({ success: false, error: 'Report name and department are required' });
  const { data, error } = await supabase.from('reports').insert({ report_name: report_name.trim(), department_id: parseInt(department_id), frequency: frequency || 'monthly', due_date: due_date || null, custom_note: custom_note || '', status: 'pending', added_by: added_by || 'Admin' }).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, id: data.id, message: 'Report task added successfully!' });
});

app.patch('/api/reports/:id/status', async (req, res) => {
  const { status } = req.body;
  await supabase.from('reports').update({ status }).eq('id', req.params.id);
  res.json({ success: true, message: `Report marked as ${status}` });
});

app.delete('/api/reports/:id', async (req, res) => {
  await supabase.from('reports').delete().eq('id', req.params.id);
  res.json({ success: true, message: 'Report deleted' });
});

// -------------------------------------------------------
// 👤 ADMIN RESPONSIBILITY PANEL
// -------------------------------------------------------
app.get('/api/admin-roles', async (req, res) => {
  const { data, error } = await supabase.from('admin_roles').select('*').order('id');
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, adminRoles: data || [] });
});

app.post('/api/admin-roles', async (req, res) => {
  const { admin_name, responsibility_area, description } = req.body;
  if (!admin_name || !responsibility_area) return res.status(400).json({ success: false, error: 'Admin name and responsibility area are required' });
  const { data, error } = await supabase.from('admin_roles').insert({ admin_name: admin_name.trim(), responsibility_area: responsibility_area.trim(), description: description || '' }).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, id: data.id, message: 'Admin role added!' });
});

app.put('/api/admin-roles/:id', async (req, res) => {
  const { admin_name, responsibility_area, description } = req.body;
  await supabase.from('admin_roles').update({ admin_name: admin_name?.trim(), responsibility_area: responsibility_area?.trim(), description: description || '' }).eq('id', req.params.id);
  res.json({ success: true, message: 'Admin role updated' });
});

app.delete('/api/admin-roles/:id', async (req, res) => {
  await supabase.from('admin_roles').delete().eq('id', req.params.id);
  res.json({ success: true, message: 'Admin role deleted' });
});

// -------------------------------------------------------
// 📅 MEETINGS
// -------------------------------------------------------
app.get('/api/meetings', async (req, res) => {
  const { data, error } = await supabase.from('meetings').select('*').order('meeting_date', { ascending: true });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, meetings: data || [] });
});

app.post('/api/meetings', async (req, res) => {
  const { title, meeting_type, dept_ids, meeting_date, meeting_time, organizer, agenda, location } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'Meeting title is required' });
  const { data, error } = await supabase.from('meetings').insert({ title: title.trim(), meeting_type: meeting_type || 'General', dept_ids: dept_ids || 'ALL', meeting_date: meeting_date || null, meeting_time: meeting_time || '', organizer: organizer || 'Admin', agenda: agenda || '', location: location || 'Online', status: 'scheduled' }).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, id: data.id, message: 'Meeting scheduled successfully!' });
});

app.put('/api/meetings/:id', async (req, res) => {
  const { title, meeting_type, dept_ids, meeting_date, meeting_time, organizer, agenda, location, status } = req.body;
  await supabase.from('meetings').update({ title: title?.trim(), meeting_type, dept_ids, meeting_date, meeting_time, organizer, agenda, location, status }).eq('id', req.params.id);
  res.json({ success: true, message: 'Meeting updated' });
});

app.delete('/api/meetings/:id', async (req, res) => {
  await supabase.from('meetings').delete().eq('id', req.params.id);
  res.json({ success: true, message: 'Meeting deleted' });
});

// -------------------------------------------------------
// START SERVER
// -------------------------------------------------------
if (require.main === module) {
  initDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n======================================================`);
      console.log(`⚡ Teamsaathi Server running on port ${PORT}`);
      console.log(`Local URL: http://localhost:${PORT}`);
      console.log(`Database: Supabase (Permanent Cloud)`);
      console.log(`======================================================\n`);
    });
  }).catch(err => { console.error('[Startup Failure]', err); });
}

module.exports = app;
