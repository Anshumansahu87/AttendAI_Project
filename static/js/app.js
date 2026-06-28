// ── State ─────────────────────────────────────────────────────────────────────
let allStudents = [];
let enrollSelected = null;
let enrollStream = null;
let cameraRunning = false;
let pollInterval = null;
let prevPresent = new Set();

// ── Clock ──────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('sidebarTime').textContent =
    now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('sidebarDate').textContent =
    now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}
setInterval(updateClock, 1000);
updateClock();

// ── Navigation ────────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const links = document.querySelectorAll('.nav-link');
  links.forEach(l => { if (l.getAttribute('onclick')?.includes(name)) l.classList.add('active'); });

  if (name === 'dashboard') { loadStudents(); loadStats(); }
  else if (name === 'students') { loadStudentsPage(); }
  else if (name === 'enroll') { loadEnrollList(); }
  else if (name === 'history') { loadHistory(); }
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  return r.json();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => el.className = 'toast', 3000);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadStats() {
  const s = await api('/api/attendance/stats');
  document.getElementById('statTotal').textContent = s.total;
  document.getElementById('statPresent').textContent = s.present;
  document.getElementById('statAbsent').textContent = s.absent;
  document.getElementById('statRate').textContent = s.rate + '%';
  document.getElementById('progressFill').style.width = s.rate + '%';
  document.getElementById('progressText').textContent = s.rate + '%';
}

async function loadStudents() {
  allStudents = await api('/api/students');
  renderRoster(allStudents);
  await loadStats();
}

function renderRoster(students) {
  const tbody = document.getElementById('rosterBody');
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:2rem;">No students found. Add students first.</td></tr>';
    return;
  }
  tbody.innerHTML = students.map((s, i) => `
    <tr>
      <td style="color:var(--text3);font-size:12px;">${i + 1}</td>
      <td><code style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--blue)">${s.roll}</code></td>
      <td style="font-weight:500;">${s.name}</td>
      <td style="color:var(--text2);font-size:12px;">${s.dept || '—'}</td>
      <td>
        <span class="badge ${s.status === 'present' ? 'badge-present' : 'badge-absent'}">
          <span class="dot" style="background:${s.status === 'present' ? 'var(--green)' : 'var(--red)'}"></span>
          ${s.status === 'present' ? 'Present' : 'Absent'}
        </span>
      </td>
      <td style="color:var(--text3);font-size:12px;font-family:'JetBrains Mono',monospace;">${s.time || '—'}</td>
      <td>
        ${s.status === 'absent'
          ? `<button class="action-btn present" onclick="markOne('${s.roll}','present')">✓ Present</button>`
          : `<button class="action-btn absent" onclick="markOne('${s.roll}','absent')">✗ Absent</button>`}
      </td>
    </tr>
  `).join('');
}

function filterRoster(q) {
  const filtered = allStudents.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) || s.roll.includes(q));
  renderRoster(filtered);
}

async function markOne(roll, status) {
  await api('/api/attendance/mark', 'POST', { roll, status });
  await loadStudents();
  toast(`Marked ${status}`, status === 'present' ? 'success' : 'error');
}

async function markAll(status) {
  for (const s of allStudents) await api('/api/attendance/mark', 'POST', { roll: s.roll, status });
  await loadStudents();
  toast(`All students marked ${status}`, 'success');
}

async function exportAttendance() {
  window.location.href = '/api/attendance/export';
}

// ── Camera ─────────────────────────────────────────────────────────────────────
async function startCamera() {
  await api('/api/camera/start', 'POST');
  cameraRunning = true;
  document.getElementById('camPlaceholder').style.display = 'none';
  const feed = document.getElementById('camFeed');
  feed.src = '/video_feed?' + Date.now();
  feed.style.display = 'block';
  document.getElementById('camBadge').style.display = 'flex';
  document.getElementById('btnStartCam').style.display = 'none';
  document.getElementById('btnStopCam').style.display = '';
  document.getElementById('camStatus').textContent = 'Active';
  document.getElementById('camStatus').className = 'badge-green';
  prevPresent = new Set(allStudents.filter(s => s.status === 'present').map(s => s.roll));
  pollInterval = setInterval(pollRecognition, 2000);
}

async function stopCamera() {
  await api('/api/camera/stop', 'POST');
  cameraRunning = false;
  clearInterval(pollInterval);
  document.getElementById('camFeed').style.display = 'none';
  document.getElementById('camPlaceholder').style.display = 'flex';
  document.getElementById('camBadge').style.display = 'none';
  document.getElementById('btnStartCam').style.display = '';
  document.getElementById('btnStopCam').style.display = 'none';
  document.getElementById('camStatus').textContent = 'Stopped';
  document.getElementById('camStatus').className = 'badge-gray';
}

async function pollRecognition() {
  const students = await api('/api/students');
  allStudents = students;
  const presentNow = new Set(students.filter(s => s.status === 'present').map(s => s.roll));
  let newCount = 0;
  for (const roll of presentNow) {
    if (!prevPresent.has(roll)) {
      const s = students.find(x => x.roll === roll);
      if (s) addRecogLog(s.name, s.time);
      newCount++;
    }
  }
  prevPresent = presentNow;
  document.getElementById('recogCount').textContent = presentNow.size + ' faces';
  await loadStats();
}

function addRecogLog(name, time) {
  const log = document.getElementById('recogLog');
  const empty = log.querySelector('.log-empty');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = 'log-item';
  item.innerHTML = `
    <div class="log-item-name" style="color:var(--green)">✓ ${name}</div>
    <div class="log-item-time">${time || new Date().toLocaleTimeString()}</div>
  `;
  log.prepend(item);
}

// ── Students Page ─────────────────────────────────────────────────────────────
async function loadStudentsPage() {
  const students = await api('/api/students');
  allStudents = students;
  const tbody = document.getElementById('studentsBody');
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:2rem;">No students. Click "+ Add Student" to get started.</td></tr>';
    return;
  }
  tbody.innerHTML = students.map((s, i) => `
    <tr>
      <td style="color:var(--text3);font-size:12px;">${i + 1}</td>
      <td><code style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--blue)">${s.roll}</code></td>
      <td style="font-weight:500;">${s.name}</td>
      <td style="color:var(--text2);font-size:12px;">${s.dept || '—'}</td>
      <td style="color:var(--text2);font-size:12px;">${s.year || '—'}</td>
      <td>
        ${s.has_photo
          ? '<span style="color:var(--green);font-size:12px;">✓ Enrolled</span>'
          : '<span style="color:var(--text3);font-size:12px;">✗ Not enrolled</span>'}
      </td>
      <td>
        <button class="action-btn delete" onclick="deleteStudent('${s.roll}','${s.name}')">🗑 Delete</button>
      </td>
    </tr>
  `).join('');
}

function toggleAddForm() {
  const f = document.getElementById('addStudentForm');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function addStudent() {
  const roll = document.getElementById('newRoll').value.trim();
  const name = document.getElementById('newName').value.trim();
  const dept = document.getElementById('newDept').value.trim();
  const year = document.getElementById('newYear').value;
  if (!roll || !name) { toast('Roll number and name are required', 'error'); return; }
  const res = await api('/api/students/add', 'POST', { roll, name, dept, year });
  if (res.error) { toast(res.error, 'error'); return; }
  toast(res.message, 'success');
  document.getElementById('newRoll').value = '';
  document.getElementById('newName').value = '';
  document.getElementById('newDept').value = '';
  document.getElementById('newYear').value = '';
  toggleAddForm();
  loadStudentsPage();
}

async function deleteStudent(roll, name) {
  if (!confirm(`Delete student ${name} (${roll})? This cannot be undone.`)) return;
  const res = await api('/api/students/delete/' + roll, 'DELETE');
  if (res.error) { toast(res.error, 'error'); return; }
  toast('Student deleted', 'success');
  loadStudentsPage();
}

// ── Enroll Page ───────────────────────────────────────────────────────────────
async function loadEnrollList(q = '') {
  const students = await api('/api/students');
  allStudents = students;
  filterEnrollList(q);
}

function filterEnrollList(q) {
  const filtered = allStudents.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) || s.roll.includes(q));
  const list = document.getElementById('enrollStudentList');
  list.innerHTML = filtered.map(s => `
    <div class="enroll-item ${enrollSelected === s.roll ? 'selected' : ''}" onclick="selectEnrollStudent('${s.roll}')">
      <div class="enroll-avatar">${s.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
      <div class="enroll-info">
        <div class="enroll-name">${s.name}</div>
        <div class="enroll-roll">${s.roll}</div>
      </div>
      ${s.has_photo ? '<span class="enrolled-check" title="Face enrolled">✓</span>' : ''}
    </div>
  `).join('') || '<p style="color:var(--text3);font-size:13px;text-align:center;">No students found.</p>';
}

function selectEnrollStudent(roll) {
  enrollSelected = roll;
  filterEnrollList(document.querySelector('#page-enroll .search-input')?.value || '');
  toast('Student selected. Open camera to enroll.', 'success');
}

async function openEnrollCamera() {
  if (!enrollSelected) { toast('Please select a student first', 'error'); return; }
  try {
    enrollStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    const video = document.getElementById('enrollVideo');
    video.srcObject = enrollStream;
    video.style.display = 'block';
    document.getElementById('enrollPlaceholder').style.display = 'none';
    document.getElementById('btnCapture').style.display = '';
    document.getElementById('btnCloseEnrollCam').style.display = '';
    document.getElementById('btnOpenEnrollCam').style.display = 'none';
  } catch (e) {
    toast('Camera access denied. Please allow camera permission.', 'error');
  }
}

function closeEnrollCamera() {
  if (enrollStream) { enrollStream.getTracks().forEach(t => t.stop()); enrollStream = null; }
  document.getElementById('enrollVideo').style.display = 'none';
  document.getElementById('enrollPlaceholder').style.display = 'flex';
  document.getElementById('btnCapture').style.display = 'none';
  document.getElementById('btnCloseEnrollCam').style.display = 'none';
  document.getElementById('btnOpenEnrollCam').style.display = '';
}

async function captureAndEnroll() {
  if (!enrollSelected) { toast('No student selected', 'error'); return; }
  const video = document.getElementById('enrollVideo');
  const canvas = document.getElementById('enrollCanvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const imageData = canvas.toDataURL('image/jpeg', 0.9);
  const res = await api('/api/enroll', 'POST', { roll: enrollSelected, image: imageData });
  const msgEl = document.getElementById('enrollMsg');
  msgEl.style.display = 'block';
  if (res.error) {
    msgEl.className = 'enroll-msg error';
    msgEl.textContent = '✗ ' + res.error;
    toast(res.error, 'error');
  } else {
    msgEl.className = 'enroll-msg success';
    msgEl.textContent = '✓ ' + res.message;
    toast(res.message, 'success');
    loadEnrollList();
    closeEnrollCamera();
  }
}

// ── History ───────────────────────────────────────────────────────────────────
async function loadHistory() {
  const history = await api('/api/attendance/history');
  const tbody = document.getElementById('historyBody');
  if (!history.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:2rem;">No history yet. Attendance will appear here after sessions.</td></tr>';
    return;
  }
  tbody.innerHTML = history.map(h => `
    <tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:12px;">${h.date}</td>
      <td style="color:var(--green);font-weight:500;">${h.present}</td>
      <td style="color:var(--text2);">${h.total}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="rate-bar-wrap"><div class="rate-bar-fill" style="width:${h.rate}%"></div></div>
          <span style="font-size:12px;color:var(--text2);">${h.rate}%</span>
        </div>
      </td>
      <td>
        <span class="badge ${h.rate >= 75 ? 'badge-present' : 'badge-absent'}">
          ${h.rate >= 75 ? 'Good' : 'Low'}
        </span>
      </td>
    </tr>
  `).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await loadStudents();
  await loadStats();
})();
