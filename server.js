const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, initDatabase, saveDb, clearDemoData } = require('./database.js');

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

// Helper to calculate best ideas per department and overall
function calculateBestIdeas() {
  const departments = db.prepare('SELECT id, name, code, icon, color FROM departments').all();
  const deptWinners = [];

  departments.forEach(dept => {
    const topIdea = db.prepare(`
      SELECT i.*, d.name as department_name, d.color as department_color, d.icon as department_icon
      FROM ideas i
      JOIN departments d ON i.department_id = d.id
      WHERE i.department_id = ?
      ORDER BY i.dept_votes DESC, i.total_votes DESC
      LIMIT 1
    `).get([dept.id]);

    if (topIdea && topIdea.total_votes > 0) {
      deptWinners.push(topIdea);
    }
  });

  const grandWinner = db.prepare(`
    SELECT i.*, d.name as department_name, d.color as department_color, d.icon as department_icon
    FROM ideas i
    JOIN departments d ON i.department_id = d.id
    ORDER BY i.total_votes DESC, i.dept_votes DESC
    LIMIT 1
  `).get();

  return { deptWinners, grandWinner };
}

// -------------------------------------------------------------
// BOOTSTRAP API (Single fast call for everything)
// -------------------------------------------------------------
app.get('/api/bootstrap', (req, res) => {
  try {
    const isUserAdmin = req.query.is_admin === 'true';
    const userName = (req.query.user_name || '').trim();
    const reqDeptId = req.query.dept_id ? parseInt(req.query.dept_id) : null;

    const departments = db.prepare('SELECT * FROM departments ORDER BY id ASC').all();

    // Links: Common links (department_id IS NULL) are open for all.
    // Department-specific links are PIN-protected and only visible when unlocked by that department's members or Admin.
    let unlockedDeptIds = [];
    if (req.query.unlocked_depts) {
      try {
        unlockedDeptIds = JSON.parse(req.query.unlocked_depts).map(n => parseInt(n)).filter(n => !isNaN(n));
      } catch(e) {
        unlockedDeptIds = String(req.query.unlocked_depts).split(',').map(n => parseInt(n)).filter(n => !isNaN(n));
      }
    }

    let links = [];
    if (isUserAdmin) {
      links = db.prepare(`
        SELECT l.*, d.name as department_name
        FROM links l
        LEFT JOIN departments d ON l.department_id = d.id
        ORDER BY l.sort_order ASC, l.id DESC
      `).all();
    } else if (unlockedDeptIds.length > 0) {
      const placeholders = unlockedDeptIds.map(() => '?').join(',');
      links = db.prepare(`
        SELECT l.*, d.name as department_name
        FROM links l
        LEFT JOIN departments d ON l.department_id = d.id
        WHERE l.department_id IS NULL OR l.department_id IN (${placeholders})
        ORDER BY l.sort_order ASC, l.id DESC
      `).all(...unlockedDeptIds);
    } else {
      links = db.prepare(`
        SELECT l.*, d.name as department_name
        FROM links l
        LEFT JOIN departments d ON l.department_id = d.id
        WHERE l.department_id IS NULL
        ORDER BY l.sort_order ASC, l.id DESC
      `).all();
    }

    const announcements = db.prepare(`
      SELECT a.*, d.name as department_name
      FROM announcements a
      LEFT JOIN departments d ON a.department_id = d.id
      ORDER BY a.is_pinned DESC, a.created_at DESC
    `).all();

    const activePoll = db.prepare('SELECT * FROM voting_polls WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get() || null;

    // Ideas: Strictly department-scoped for employees; Admins can see all
    let ideas = [];
    if (isUserAdmin) {
      ideas = db.prepare(`
        SELECT i.*, d.name as department_name, d.icon as department_icon, b.title as bottleneck_title
        FROM ideas i
        JOIN departments d ON i.department_id = d.id
        LEFT JOIN bottlenecks b ON i.bottleneck_id = b.id
        ORDER BY i.total_votes DESC, i.id DESC
      `).all();
    } else {
      let targetDeptId = reqDeptId;
      if (!targetDeptId && userName) {
        const mem = db.prepare('SELECT department_id FROM team_members WHERE LOWER(name) = LOWER(?)').get(userName);
        if (mem) targetDeptId = mem.department_id;
      }
      if (targetDeptId) {
        ideas = db.prepare(`
          SELECT i.*, d.name as department_name, d.icon as department_icon, b.title as bottleneck_title
          FROM ideas i
          JOIN departments d ON i.department_id = d.id
          LEFT JOIN bottlenecks b ON i.bottleneck_id = b.id
          WHERE i.department_id = ?
          ORDER BY i.total_votes DESC, i.id DESC
        `).all([targetDeptId]);
      } else {
        ideas = [];
      }
    }

    // Confidential Bottlenecks: Only Admin sees all; Employees only see their own
    let bottlenecks = [];
    if (isUserAdmin) {
      bottlenecks = db.prepare(`
        SELECT b.*, d.name as department_name, d.color as department_color
        FROM bottlenecks b
        JOIN departments d ON b.department_id = d.id
        ORDER BY
          CASE b.severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 ELSE 3 END,
          b.id DESC
      `).all();
    } else if (userName) {
      bottlenecks = db.prepare(`
        SELECT b.*, d.name as department_name, d.color as department_color
        FROM bottlenecks b
        JOIN departments d ON b.department_id = d.id
        WHERE LOWER(b.reported_by) = LOWER(?)
        ORDER BY b.id DESC
      `).all([userName]);
    }

    const chat = db.prepare(`
      SELECT c.*, d.name as department_name, d.color as department_color
      FROM chat_messages c
      JOIN departments d ON c.sender_department_id = d.id
      ORDER BY c.created_at DESC
      LIMIT 60
    `).all().reverse();

    const teamMembers = db.prepare(`
      SELECT m.*, d.name as department_name, d.color as department_color
      FROM team_members m
      JOIN departments d ON m.department_id = d.id
      WHERE m.is_active = 1
      ORDER BY m.name ASC
    `).all();

    const { deptWinners, grandWinner } = calculateBestIdeas();

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
      bestIdeas: {
        deptWinners,
        grandWinner
      }
    });
  } catch (err) {
    console.error('[Bootstrap Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// DEPARTMENTS MANAGEMENT API
// -------------------------------------------------------------
app.get('/api/departments', (req, res) => {
  const departments = db.prepare('SELECT * FROM departments ORDER BY id ASC').all();
  res.json({ success: true, departments });
});

app.post('/api/departments', (req, res) => {
  const { name, code, icon, color } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: 'Department name is required' });
  }
  const cleanCode = (code || name.substring(0, 3)).toUpperCase().trim();
  const cleanIcon = icon || '🏢';
  const cleanColor = color || '#2A6FA8';

  try {
    const result = db.prepare(`
      INSERT INTO departments (name, code, icon, color)
      VALUES (?, ?, ?, ?)
    `).run(name.trim(), cleanCode, cleanIcon, cleanColor);

    res.json({ success: true, id: result.lastInsertRowid, message: `Department '${name}' created successfully` });
  } catch (err) {
    res.status(400).json({ success: false, error: 'Department name or code already exists' });
  }
});

app.put('/api/departments/:id', (req, res) => {
  const { id } = req.params;
  const { name, code, icon, color } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: 'Department name is required' });
  }

  try {
    db.prepare(`
      UPDATE departments
      SET name = ?, code = ?, icon = ?, color = ?
      WHERE id = ?
    `).run(name.trim(), (code || name.substring(0, 3)).toUpperCase().trim(), icon || '🏢', color || '#2A6FA8', id);

    res.json({ success: true, message: 'Department updated successfully' });
  } catch (err) {
    res.status(400).json({ success: false, error: 'Failed to update department' });
  }
});

app.delete('/api/departments/:id', (req, res) => {
  const { id } = req.params;
  const count = db.prepare('SELECT COUNT(*) as count FROM departments').get().count;
  if (count <= 1) {
    return res.status(400).json({ success: false, error: 'Cannot delete the only remaining department' });
  }

  try {
    db.prepare('DELETE FROM departments WHERE id = ?').run(id);
    res.json({ success: true, message: 'Department deleted successfully' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// ADMIN AUTHENTICATION (PASSWORD ONLY - NO EMAIL REQUIRED)
// -------------------------------------------------------------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required' });
  }

  const allAdmins = db.prepare('SELECT * FROM admin_passwords').all();
  let matchedAdmin = null;

  for (const admin of allAdmins) {
    if (bcrypt.compareSync(password, admin.password_hash)) {
      matchedAdmin = admin;
      break;
    }
  }

  if (matchedAdmin) {
    let perms = ['all'];
    try {
      if (matchedAdmin.permissions && matchedAdmin.permissions !== 'all') {
        perms = JSON.parse(matchedAdmin.permissions);
      }
    } catch(e) {
      perms = (matchedAdmin.permissions || 'all').split(',');
    }

    return res.json({
      success: true,
      adminId: matchedAdmin.id,
      adminName: matchedAdmin.admin_name,
      permissions: perms,
      message: 'Admin authenticated successfully'
    });
  }

  return res.status(401).json({ success: false, error: 'Incorrect admin password. Please try again.' });
});

// GET all admin passkeys
app.get('/api/admin/passwords', (req, res) => {
  const admins = db.prepare('SELECT id, admin_name, permissions, plain_preview, created_at FROM admin_passwords ORDER BY id ASC').all();
  const formatted = admins.map(a => {
    let perms = ['all'];
    try {
      if (a.permissions && a.permissions !== 'all') perms = JSON.parse(a.permissions);
    } catch(e) {
      perms = (a.permissions || 'all').split(',');
    }
    return {
      id: a.id,
      admin_name: a.admin_name,
      permissions: perms,
      plain_preview: a.plain_preview || '••••••••',
      created_at: a.created_at
    };
  });
  res.json({ success: true, admins: formatted });
});

// CREATE another admin password
app.post('/api/admin/passwords', (req, res) => {
  const { adminName, newPassword, permissions } = req.body;
  if (!adminName || !newPassword || newPassword.length < 4) {
    return res.status(400).json({ success: false, error: 'Admin name and password (min 4 chars) are required' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  const permsStr = typeof permissions === 'string' ? permissions : JSON.stringify(permissions || ['all']);
  const result = db.prepare(`
    INSERT INTO admin_passwords (admin_name, password_hash, permissions, plain_preview)
    VALUES (?, ?, ?, ?)
  `).run(adminName.trim(), hash, permsStr, newPassword.trim());

  res.json({ success: true, id: result.lastInsertRowid, message: `New admin passkey '${adminName}' created successfully!` });
});

// CHANGE / EDIT admin password & permissions
app.put('/api/admin/passwords/:id', (req, res) => {
  const { id } = req.params;
  const { adminName, newPassword, permissions } = req.body;

  const current = db.prepare('SELECT * FROM admin_passwords WHERE id = ?').get([id]);
  if (!current) return res.status(404).json({ success: false, error: 'Admin passkey not found' });

  let hash = current.password_hash;
  let plain = current.plain_preview;

  if (newPassword && newPassword.trim().length >= 4) {
    hash = bcrypt.hashSync(newPassword.trim(), 10);
    plain = newPassword.trim();
  }

  const name = adminName ? adminName.trim() : current.admin_name;
  let permsStr = current.permissions;
  if (permissions !== undefined) {
    permsStr = typeof permissions === 'string' ? permissions : JSON.stringify(permissions);
  }

  db.prepare(`
    UPDATE admin_passwords
    SET admin_name = ?, password_hash = ?, permissions = ?, plain_preview = ?
    WHERE id = ?
  `).run(name, hash, permsStr, plain, id);

  res.json({ success: true, message: 'Admin passkey updated successfully' });
});

// DELETE admin password
app.delete('/api/admin/passwords/:id', (req, res) => {
  const { id } = req.params;
  const countRow = db.prepare('SELECT COUNT(*) as count FROM admin_passwords').get();
  if (countRow.count <= 1) {
    return res.status(400).json({ success: false, error: 'Cannot delete the only remaining admin password' });
  }

  db.prepare('DELETE FROM admin_passwords WHERE id = ?').run(id);
  res.json({ success: true, message: 'Admin password removed' });
});

// -------------------------------------------------------------
// LINKS DIRECTORY API
// -------------------------------------------------------------
app.post('/api/links', (req, res) => {
  const { title, url, category, department_id, tags, icon } = req.body;
  if (!title || !url) {
    return res.status(400).json({ success: false, error: 'Title and URL are required' });
  }
  const cleanUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const deptId = department_id ? parseInt(department_id) : null;
  const cleanIcon = icon || '🔗';

  const result = db.prepare(`
    INSERT INTO links (title, url, category, department_id, tags, icon)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title.trim(), cleanUrl.trim(), category || 'other', deptId, tags || '', cleanIcon);

  res.json({ success: true, id: result.lastInsertRowid, message: 'Link created successfully' });
});

app.put('/api/links/:id', (req, res) => {
  const { id } = req.params;
  const { title, url, category, department_id, tags, icon } = req.body;
  const cleanUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;

  db.prepare(`
    UPDATE links
    SET title = ?, url = ?, category = ?, department_id = ?, tags = ?, icon = ?
    WHERE id = ?
  `).run(title.trim(), cleanUrl.trim(), category || 'other', department_id ? parseInt(department_id) : null, tags || '', icon || '🔗', id);

  res.json({ success: true, message: 'Link updated successfully' });
});

app.delete('/api/links/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM links WHERE id = ?').run(id);
  res.json({ success: true, message: 'Link deleted' });
});

// UNLOCK DEPARTMENT LINKS VIA 4-DIGIT PIN
app.post('/api/links/unlock-dept', (req, res) => {
  const { department_id, pin } = req.body;
  if (!department_id || !pin) {
    return res.status(400).json({ success: false, error: 'Department ID and PIN are required' });
  }

  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(department_id);
  if (!dept) {
    return res.status(404).json({ success: false, error: 'Department not found' });
  }

  // Check if PIN matches any member belonging to this department
  const members = db.prepare('SELECT id, name, department_id, password_hash, plain_preview FROM team_members WHERE department_id = ?').all(department_id);
  const matched = members.find(m => {
    if (m.plain_preview && m.plain_preview === pin.trim()) return true;
    if (m.password_hash && bcrypt.compareSync(pin.trim(), m.password_hash)) return true;
    return false;
  });

  if (!matched) {
    return res.status(401).json({
      success: false,
      error: `Incorrect PIN for ${dept.name}. Only verified members of ${dept.name} can unlock these confidential links.`
    });
  }

  // Return the department links and common links
  const links = db.prepare(`
    SELECT l.*, d.name as department_name
    FROM links l
    LEFT JOIN departments d ON l.department_id = d.id
    WHERE l.department_id IS NULL OR l.department_id = ?
    ORDER BY l.sort_order ASC, l.id DESC
  `).all(department_id);

  res.json({
    success: true,
    department_id: parseInt(department_id),
    department_name: dept.name,
    member_name: matched.name,
    links,
    message: `${dept.name} links unlocked successfully for ${matched.name}!`
  });
});

// -------------------------------------------------------------
// ANNOUNCEMENTS API
// -------------------------------------------------------------
app.post('/api/announcements', (req, res) => {
  const { title, content, priority, department_id, tags, is_pinned } = req.body;
  if (!title || !content) {
    return res.status(400).json({ success: false, error: 'Title and content are required' });
  }

  const result = db.prepare(`
    INSERT INTO announcements (title, content, priority, department_id, tags, is_pinned)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title.trim(), content.trim(), priority || 'General', department_id ? parseInt(department_id) : null, tags || '', is_pinned ? 1 : 0);

  res.json({ success: true, id: result.lastInsertRowid, message: 'Announcement posted' });
});

app.patch('/api/announcements/:id/pin', (req, res) => {
  const { id } = req.params;
  const current = db.prepare('SELECT is_pinned FROM announcements WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ success: false, error: 'Not found' });

  const nextPinned = current.is_pinned ? 0 : 1;
  db.prepare('UPDATE announcements SET is_pinned = ? WHERE id = ?').run(nextPinned, id);
  res.json({ success: true, is_pinned: nextPinned });
});

app.put('/api/announcements/:id', (req, res) => {
  const { id } = req.params;
  const { title, content, priority, department_id, tags, is_pinned } = req.body;
  if (!title || !content) {
    return res.status(400).json({ success: false, error: 'Title and content are required' });
  }

  db.prepare(`
    UPDATE announcements
    SET title = ?, content = ?, priority = ?, department_id = ?, tags = ?, is_pinned = ?
    WHERE id = ?
  `).run(
    title.trim(),
    content.trim(),
    priority || 'General',
    department_id ? parseInt(department_id) : null,
    tags || '',
    is_pinned ? 1 : 0,
    id
  );

  res.json({ success: true, message: 'Company update updated successfully' });
});

app.delete('/api/announcements/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  res.json({ success: true, message: 'Announcement deleted' });
});

// CLEAR DEMO DATA (Admin Action)
app.post('/api/admin/clear-demo-data', (req, res) => {
  try {
    clearDemoData();
    res.json({ success: true, message: 'All demo bottlenecks, ideas, votes, and chat messages cleared successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// IDEAS & DEPARTMENT-ISOLATED VOTING ENGINE
// -------------------------------------------------------------
app.get('/api/ideas', (req, res) => {
  const isUserAdmin = req.query.is_admin === 'true';
  const deptId = req.query.dept_id ? parseInt(req.query.dept_id) : null;
  const userName = (req.query.user_name || '').trim();

  if (isUserAdmin) {
    const list = db.prepare(`
      SELECT i.*, d.name as department_name, d.icon as department_icon, b.title as bottleneck_title
      FROM ideas i
      JOIN departments d ON i.department_id = d.id
      LEFT JOIN bottlenecks b ON i.bottleneck_id = b.id
      ORDER BY i.total_votes DESC, i.id DESC
    `).all();
    return res.json({ success: true, ideas: list });
  }

  let targetDeptId = deptId;
  if (!targetDeptId && userName) {
    const member = db.prepare('SELECT department_id FROM team_members WHERE LOWER(name) = LOWER(?)').get(userName);
    if (member) targetDeptId = member.department_id;
  }

  if (!targetDeptId) {
    return res.json({ success: true, ideas: [] });
  }

  const list = db.prepare(`
    SELECT i.*, d.name as department_name, d.icon as department_icon, b.title as bottleneck_title
    FROM ideas i
    JOIN departments d ON i.department_id = d.id
    LEFT JOIN bottlenecks b ON i.bottleneck_id = b.id
    WHERE i.department_id = ?
    ORDER BY i.total_votes DESC, i.id DESC
  `).all(targetDeptId);

  res.json({ success: true, ideas: list });
});

// SUBMIT NEW IDEA (Starts in Pending Poll Approval with is_locked=1)
app.post('/api/ideas', (req, res) => {
  const { poll_id, title, department_id, category, description, expected_impact, tags, bottleneck_id, submitter_name } = req.body;
  if (!title || !department_id || !description || !submitter_name) {
    return res.status(400).json({ success: false, error: 'Title, department, description, and submitter name are required' });
  }

  const result = db.prepare(`
    INSERT INTO ideas (poll_id, title, department_id, category, description, expected_impact, tags, bottleneck_id, submitter_name, is_locked, poll_allowed, admin_notification, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1, 'Submitted')
  `).run(
    poll_id ? parseInt(poll_id) : 1,
    title.trim(),
    parseInt(department_id),
    category || 'Process Automation',
    description.trim(),
    expected_impact || '',
    tags || '',
    bottleneck_id ? parseInt(bottleneck_id) : null,
    submitter_name.trim()
  );

  // If linked to a bottleneck, update bottleneck status
  if (bottleneck_id) {
    db.prepare("UPDATE bottlenecks SET status = 'Solution Linked' WHERE id = ?").run(bottleneck_id);
  }

  res.json({
    success: true,
    id: result.lastInsertRowid,
    message: 'Idea submitted! Admin has been notified to allow voting poll for your department.'
  });
});

// ADMIN ALLOWS POLL FOR AN INDIVIDUAL IDEA
app.patch('/api/ideas/:id/allow-poll', (req, res) => {
  const { id } = req.params;
  const current = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ success: false, error: 'Idea not found' });

  db.prepare(`
    UPDATE ideas
    SET is_locked = 0, poll_allowed = 1, admin_notification = 0
    WHERE id = ?
  `).run(id);

  res.json({
    success: true,
    is_locked: 0,
    poll_allowed: 1,
    message: `Voting poll opened for "${current.title}"! Department team can now vote.`
  });
});

// VOTE ON AN IDEA (STRICT: SAME DEPARTMENT ONLY & POLL MUST BE ALLOWED)
app.post('/api/ideas/:id/vote', (req, res) => {
  const { id } = req.params;
  const { voter_name, voter_department_id } = req.body;

  if (!voter_name || !voter_department_id) {
    return res.status(400).json({ success: false, error: 'Voter name and department are required' });
  }

  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
  if (!idea) {
    return res.status(404).json({ success: false, error: 'Idea not found' });
  }

  // Strict department check: Only department members can vote on this idea
  if (parseInt(voter_department_id) !== parseInt(idea.department_id)) {
    return res.status(403).json({ success: false, error: 'Confidential: You can only vote on ideas within your own department.' });
  }

  // Check if voting is locked or poll not yet allowed by Admin
  if (idea.is_locked === 1 || idea.poll_allowed === 0) {
    return res.status(400).json({ success: false, error: 'Voting is currently closed for this idea. Admin must allow the poll first.' });
  }

  // Check if overall poll cycle is active
  const poll = idea.poll_id ? db.prepare('SELECT is_active FROM voting_polls WHERE id = ?').get(idea.poll_id) : null;
  if (poll && poll.is_active === 0) {
    return res.status(400).json({ success: false, error: 'Voting is currently closed for this poll cycle.' });
  }

  // Check duplicate vote
  const existingVote = db.prepare('SELECT id FROM votes WHERE idea_id = ? AND voter_name = ?').get(id, voter_name.trim());
  if (existingVote) {
    return res.status(400).json({ success: false, error: 'You have already voted for this idea!' });
  }

  // Record vote
  db.prepare(`
    INSERT INTO votes (idea_id, poll_id, voter_name, voter_department_id)
    VALUES (?, ?, ?, ?)
  `).run(id, idea.poll_id || null, voter_name.trim(), parseInt(voter_department_id));

  // Increment total votes and department votes
  db.prepare('UPDATE ideas SET total_votes = total_votes + 1, dept_votes = dept_votes + 1 WHERE id = ?').run(id);

  const updatedIdea = db.prepare('SELECT total_votes, dept_votes FROM ideas WHERE id = ?').get(id);

  res.json({
    success: true,
    total_votes: updatedIdea.total_votes,
    dept_votes: updatedIdea.dept_votes,
    message: 'Vote recorded successfully!'
  });
});

// EDIT AN IDEA
app.put('/api/ideas/:id', (req, res) => {
  const { id } = req.params;
  const { title, department_id, category, description, expected_impact, tags, submitter_name } = req.body;
  if (!title || !description) {
    return res.status(400).json({ success: false, error: 'Title and description are required' });
  }

  const current = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ success: false, error: 'Idea not found' });

  db.prepare(`
    UPDATE ideas
    SET title = ?, department_id = ?, category = ?, description = ?, expected_impact = ?, tags = ?, submitter_name = ?
    WHERE id = ?
  `).run(
    title.trim(),
    department_id ? parseInt(department_id) : current.department_id,
    category || current.category,
    description.trim(),
    expected_impact || '',
    tags || '',
    submitter_name ? submitter_name.trim() : current.submitter_name,
    id
  );

  res.json({ success: true, message: 'Idea updated successfully' });
});

// DELETE AN IDEA
app.delete('/api/ideas/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM votes WHERE idea_id = ?').run(id);
  db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
  res.json({ success: true, message: 'Idea deleted successfully' });
});

// LOCK / UNLOCK VOTING FOR A SPECIFIC IDEA
app.patch('/api/ideas/:id/lock', (req, res) => {
  const { id } = req.params;
  const current = db.prepare('SELECT is_locked FROM ideas WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ success: false, error: 'Idea not found' });

  const nextLocked = current.is_locked ? 0 : 1;
  db.prepare('UPDATE ideas SET is_locked = ? WHERE id = ?').run(nextLocked, id);
  res.json({
    success: true,
    is_locked: nextLocked,
    message: nextLocked ? 'Voting closed for this idea' : 'Voting reopened for this idea'
  });
});

// MARK IDEA AS SELECTED FOR IMPLEMENTATION & BROADCAST TO CHAT + PERSONAL WINDOW
app.patch('/api/ideas/:id/select', (req, res) => {
  const { id } = req.params;
  const current = db.prepare(`
    SELECT i.*, d.name as department_name, d.icon as department_icon
    FROM ideas i
    JOIN departments d ON i.department_id = d.id
    WHERE i.id = ?
  `).get(id);
  if (!current) return res.status(404).json({ success: false, error: 'Idea not found' });

  const nextSelected = current.is_selected ? 0 : 1;
  const newStatus = nextSelected ? 'Selected' : 'Submitted';
  const nextLocked = nextSelected ? 1 : current.is_locked;

  db.prepare(`
    UPDATE ideas
    SET is_selected = ?, status = ?, is_locked = ?, selection_notified = ?
    WHERE id = ?
  `).run(
    nextSelected,
    newStatus,
    nextLocked,
    nextSelected ? 1 : 0,
    id
  );

  // When selected, automatically broadcast celebratory announcement into Team Chat
  if (nextSelected) {
    try {
      const chatMsg = `🎉 Milestone Announcement: "${current.title}" pitched by ${current.submitter_name} (${current.department_name}) has been officially SELECTED FOR IMPLEMENTATION by Leadership! 🚀 #selected #innovation #milestone`;
      db.prepare(`
        INSERT INTO chat_messages (sender_name, sender_department_id, message, tags)
        VALUES ('Leadership Announcement', ?, ?, '#selected #innovation #milestone')
      `).run(current.department_id, chatMsg);
    } catch(e) {
      console.error('[Chat Broadcast Error]', e);
    }
  }

  res.json({
    success: true,
    is_selected: nextSelected,
    status: newStatus,
    is_locked: nextLocked,
    message: nextSelected ? `"${current.title}" selected for implementation! Broadcasted to Team Chat.` : 'Idea unselected'
  });
});

app.patch('/api/ideas/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  db.prepare('UPDATE ideas SET status = ? WHERE id = ?').run(status, id);
  res.json({ success: true, message: `Status updated to ${status}` });
});

// -------------------------------------------------------------
// POLL CONTROLLER (START / STOP / DECLARE WINNERS)
// -------------------------------------------------------------
app.post('/api/polls', (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'Poll title required' });

  // Close previous active polls
  db.prepare('UPDATE voting_polls SET is_active = 0').run();

  const result = db.prepare(`
    INSERT INTO voting_polls (title, description, is_active)
    VALUES (?, ?, 1)
  `).run(title.trim(), description || '');

  res.json({ success: true, id: result.lastInsertRowid, message: 'New voting poll started!' });
});

app.patch('/api/polls/:id/toggle', (req, res) => {
  const { id } = req.params;
  const current = db.prepare('SELECT is_active FROM voting_polls WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ success: false, error: 'Poll not found' });

  const nextActive = current.is_active ? 0 : 1;
  db.prepare('UPDATE voting_polls SET is_active = ? WHERE id = ?').run(nextActive, id);

  res.json({
    success: true,
    is_active: nextActive,
    message: nextActive ? 'Poll voting opened!' : 'Poll voting closed and locked.'
  });
});

// -------------------------------------------------------------
// BOTTLENECK TRACKER (CONFIDENTIAL: ADMIN & SUBMITTER ONLY)
// -------------------------------------------------------------
app.get('/api/bottlenecks', (req, res) => {
  const isUserAdmin = req.query.is_admin === 'true';
  const userName = (req.query.user_name || '').trim();

  let list = [];
  if (isUserAdmin) {
    list = db.prepare(`
      SELECT b.*, d.name as department_name, d.color as department_color
      FROM bottlenecks b
      JOIN departments d ON b.department_id = d.id
      ORDER BY
        CASE b.severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 ELSE 3 END,
        b.id DESC
    `).all();
  } else if (userName) {
    list = db.prepare(`
      SELECT b.*, d.name as department_name, d.color as department_color
      FROM bottlenecks b
      JOIN departments d ON b.department_id = d.id
      WHERE LOWER(b.reported_by) = LOWER(?)
      ORDER BY b.id DESC
    `).all([userName]);
  }
  res.json({ success: true, bottlenecks: list });
});

app.post('/api/bottlenecks', (req, res) => {
  const { department_id, title, details, severity, hours_lost_week, tags, reported_by, solution_1, solution_2, solution_3 } = req.body;
  if (!title || !department_id || !reported_by) {
    return res.status(400).json({ success: false, error: 'Title, department, and reporter name are required' });
  }

  const result = db.prepare(`
    INSERT INTO bottlenecks (department_id, title, details, severity, hours_lost_week, tags, reported_by, solution_1, solution_2, solution_3, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Under Review')
  `).run(
    parseInt(department_id),
    title.trim(),
    details || '',
    severity || 'High',
    parseFloat(hours_lost_week) || 0,
    tags || '',
    reported_by.trim(),
    solution_1 ? solution_1.trim() : '',
    solution_2 ? solution_2.trim() : '',
    solution_3 ? solution_3.trim() : ''
  );

  res.json({ success: true, id: result.lastInsertRowid, message: 'Bottleneck logged under review successfully' });
});

app.patch('/api/bottlenecks/:id/review', (req, res) => {
  const { id } = req.params;
  const { status, admin_notes } = req.body;
  const current = db.prepare('SELECT * FROM bottlenecks WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ success: false, error: 'Bottleneck not found' });

  const newStatus = status || current.status;
  const newNotes = admin_notes !== undefined ? admin_notes.trim() : (current.admin_notes || '');

  db.prepare(`
    UPDATE bottlenecks
    SET status = ?, admin_notes = ?
    WHERE id = ?
  `).run(newStatus, newNotes, id);

  res.json({ success: true, status: newStatus, admin_notes: newNotes, message: `Review updated successfully for ${current.title}` });
});

app.patch('/api/bottlenecks/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  db.prepare('UPDATE bottlenecks SET status = ? WHERE id = ?').run(status, id);
  res.json({ success: true, message: `Hurdle marked as ${status}` });
});

app.delete('/api/bottlenecks/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM bottlenecks WHERE id = ?').run(id);
  res.json({ success: true, message: 'Bottleneck deleted' });
});

// -------------------------------------------------------------
// TEAM CHAT API
// -------------------------------------------------------------
app.post('/api/chat', (req, res) => {
  try {
    const { sender_name, sender_department_id, message, tags } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Sender name, department, and message are required' });
    }

    const cleanSender = (sender_name || 'Team Member').trim();
    let deptId = parseInt(sender_department_id);

    // Validate department exists or fallback
    const dept = !isNaN(deptId) ? db.prepare('SELECT id FROM departments WHERE id = ?').get(deptId) : null;
    if (!dept) {
      const firstDept = db.prepare('SELECT id FROM departments ORDER BY id ASC LIMIT 1').get();
      deptId = firstDept ? firstDept.id : 1;
    }

    const autoTags = tags || (message.match(/#[a-zA-Z0-9_]+/g) || []).join(' ');

    const result = db.prepare(`
      INSERT INTO chat_messages (sender_name, sender_department_id, message, tags)
      VALUES (?, ?, ?, ?)
    `).run(cleanSender, deptId, message.trim(), autoTags);

    const newMsg = db.prepare(`
      SELECT c.*, d.name as department_name, d.color as department_color
      FROM chat_messages c
      JOIN departments d ON c.sender_department_id = d.id
      ORDER BY c.id DESC LIMIT 1
    `).get();

    res.json({ success: true, message: newMsg });
  } catch (err) {
    console.error('[Chat Post Error]', err);
    res.status(500).json({ success: false, error: 'Could not send message: ' + err.message });
  }
});

// -------------------------------------------------------------
// TEAM MEMBERS DIRECTORY API
// -------------------------------------------------------------
app.post('/api/team-members', (req, res) => {
  const { name, department_id, role_title } = req.body;
  if (!name || !department_id) {
    return res.status(400).json({ success: false, error: 'Name and department are required' });
  }

  const result = db.prepare(`
    INSERT INTO team_members (name, department_id, role_title)
    VALUES (?, ?, ?)
  `).run(name.trim(), parseInt(department_id), role_title || 'Team Member');

  res.json({ success: true, id: result.lastInsertRowid, message: 'Team member added' });
});

app.put('/api/team-members/:id', (req, res) => {
  const { id } = req.params;
  const { name, department_id, role_title } = req.body;
  if (!name || !department_id) {
    return res.status(400).json({ success: false, error: 'Name and department are required' });
  }

  db.prepare(`
    UPDATE team_members
    SET name = ?, department_id = ?, role_title = ?
    WHERE id = ?
  `).run(name.trim(), parseInt(department_id), role_title || 'Team Member', id);

  res.json({ success: true, message: 'Team member updated successfully' });
});

app.delete('/api/team-members/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM team_members WHERE id = ?').run(id);
  res.json({ success: true, message: 'Team member removed' });
});

// -------------------------------------------------------------
// PERSONAL WINDOW & CREDENTIALS API
// -------------------------------------------------------------

// Employee Login to Personal Window
app.post('/api/personal/login', (req, res) => {
  const { member_id, name, password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password or PIN is required' });
  }

  let member = null;
  if (member_id) {
    member = db.prepare('SELECT m.*, d.name as department_name FROM team_members m JOIN departments d ON m.department_id = d.id WHERE m.id = ?').get(member_id);
  } else if (name) {
    member = db.prepare('SELECT m.*, d.name as department_name FROM team_members m JOIN departments d ON m.department_id = d.id WHERE LOWER(m.name) = LOWER(?)').get(name.trim());
  }

  if (!member) {
    return res.status(404).json({ success: false, error: 'Team member not found' });
  }

  // Verify password / PIN
  let valid = false;
  if (member.password_hash) {
    valid = bcrypt.compareSync(password.trim(), member.password_hash);
  }
  if (!valid && member.plain_preview && member.plain_preview === password.trim()) {
    valid = true;
  }

  if (!valid) {
    return res.status(401).json({ success: false, error: 'Incorrect personal passkey/PIN. Please try again.' });
  }

  // Fetch member's personal bottlenecks
  const bottlenecks = db.prepare(`
    SELECT b.*, d.name as department_name, d.color as department_color
    FROM bottlenecks b
    JOIN departments d ON b.department_id = d.id
    WHERE LOWER(b.reported_by) = LOWER(?)
    ORDER BY b.id DESC
  `).all(member.name);

  // Fetch member's submitted ideas
  const ideas = db.prepare(`
    SELECT i.*, d.name as department_name
    FROM ideas i
    JOIN departments d ON i.department_id = d.id
    WHERE LOWER(i.submitter_name) = LOWER(?)
    ORDER BY i.id DESC
  `).all(member.name);

  // Parse personal links
  let personalLinks = [];
  try {
    if (member.personal_links) {
      personalLinks = JSON.parse(member.personal_links);
    }
  } catch(e) {
    personalLinks = [];
  }

  // Fetch department-wide ideas for this member's department
  const departmentIdeas = db.prepare(`
    SELECT i.*, d.name as department_name, d.icon as department_icon
    FROM ideas i
    JOIN departments d ON i.department_id = d.id
    WHERE i.department_id = ?
    ORDER BY i.total_votes DESC, i.id DESC
  `).all(member.department_id);

  // Check if any idea pitched by this member was selected
  const selectedIdea = ideas.find(i => i.is_selected === 1) || null;

  res.json({
    success: true,
    member: {
      id: member.id,
      name: member.name,
      department_id: member.department_id,
      department_name: member.department_name,
      role_title: member.role_title
    },
    bottlenecks,
    ideas,
    department_ideas: departmentIdeas,
    selected_idea: selectedIdea,
    personal_links: personalLinks,
    message: `Welcome to your Personal Window, ${member.name}!`
  });
});

// Employee updates their personal password/PIN
app.patch('/api/personal/password', (req, res) => {
  const { member_id, current_password, new_password } = req.body;
  if (!member_id || !new_password || new_password.trim().length < 3) {
    return res.status(400).json({ success: false, error: 'New password/PIN must be at least 3 characters' });
  }

  const member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(member_id);
  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });

  // Verify current password if exists
  if (member.password_hash) {
    const valid = bcrypt.compareSync(current_password ? current_password.trim() : '', member.password_hash);
    if (!valid && member.plain_preview !== current_password) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    }
  }

  const hash = bcrypt.hashSync(new_password.trim(), 10);
  db.prepare('UPDATE team_members SET password_hash = ?, plain_preview = ? WHERE id = ?').run(hash, new_password.trim(), member_id);

  res.json({ success: true, message: 'Personal passkey updated successfully!' });
});

// Admin Personal Directory (all members with plain passkeys and personal links)
app.get('/api/admin/personal-roster', (req, res) => {
  const members = db.prepare(`
    SELECT m.id, m.name, m.role_title, m.plain_preview, m.personal_links, m.created_at,
           d.id as department_id, d.name as department_name, d.icon as department_icon
    FROM team_members m
    JOIN departments d ON m.department_id = d.id
    ORDER BY d.id ASC, m.name ASC
  `).all();

  const formatted = members.map(m => {
    let pLinks = [];
    try {
      if (m.personal_links) pLinks = JSON.parse(m.personal_links);
    } catch(e) {}
    return {
      id: m.id,
      name: m.name,
      department_id: m.department_id,
      department_name: m.department_name,
      department_icon: m.department_icon,
      role_title: m.role_title,
      plain_preview: m.plain_preview || '1234',
      personal_links: pLinks,
      personal_links_count: pLinks.length,
      created_at: m.created_at
    };
  });

  res.json({ success: true, roster: formatted });
});

// Admin sets employee passkey and/or personal links
app.put('/api/admin/team-members/:id/credentials', (req, res) => {
  const { id } = req.params;
  const { new_password, personal_links } = req.body;

  const member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(id);
  if (!member) return res.status(404).json({ success: false, error: 'Member not found' });

  let hash = member.password_hash;
  let plain = member.plain_preview;

  if (new_password && new_password.trim().length >= 3) {
    hash = bcrypt.hashSync(new_password.trim(), 10);
    plain = new_password.trim();
  }

  let linksStr = member.personal_links;
  if (personal_links !== undefined) {
    linksStr = typeof personal_links === 'string' ? personal_links : JSON.stringify(personal_links);
  }

  db.prepare(`
    UPDATE team_members
    SET password_hash = ?, plain_preview = ?, personal_links = ?
    WHERE id = ?
  `).run(hash, plain, linksStr, id);

  res.json({ success: true, message: `Personal credentials updated for ${member.name}!` });
});

// Start Server after DB is initialized when run directly (local / Render)
if (require.main === module) {
  initDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n======================================================`);
      console.log(`⚡ Teamsaathi Server is running on port ${PORT}`);
      console.log(`Local URL: http://localhost:${PORT}`);
      console.log(`Default Admin Password: admin123 (Change inside Admin Area)`);
      console.log(`======================================================\n`);
    });
  }).catch(err => {
    console.error('[Startup Failure]', err);
  });
}

module.exports = app;
