type DashboardPageOptions = {
  email: string;
};

function baseCss() {
  return `
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif; margin:24px; max-width: 1100px}
    code{background:#f2f2f2; padding:2px 4px; border-radius:4px}
    a{color:#0b5fff; text-decoration:none}
    a:hover{text-decoration:underline}
    .row{display:flex; gap:12px; align-items:center; flex-wrap:wrap}
    input,select,textarea,button{font-size:14px; padding:8px 10px}
    textarea{width:100%; max-width: 900px}
    table{border-collapse:collapse; width:100%}
    th,td{border-bottom:1px solid #eee; padding:8px; text-align:left; font-size:14px; vertical-align:top}
    .muted{color:#666}
    .pill{display:inline-block; padding:2px 8px; border-radius:999px; background:#f2f2f2; font-size:12px}
    .danger{background:#b00020; color:white; border:none}
    .danger:hover{filter:brightness(0.95)}
    .card{border:1px solid #eee; border-radius:10px; padding:14px; margin:12px 0}
  `;
}

function baseScript() {
  return `
    function escapeHtml(s){
      return String(s ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#39;'}[c]));
    }

    function isoOrEmpty(s){
      if (!s) return '';
      try { return new Date(s).toISOString().slice(0,16); } catch { return ''; }
    }
  `;
}

export function renderLogin(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>clawdbot-projects login</title>
  <style>${baseCss()}</style>
</head>
<body>
  <h1>Dashboard login</h1>
  <p>Request a magic link (15 minutes). Check your email for the sign-in link.</p>

  <div class="row">
    <input id="email" placeholder="you@example.com" size="32" />
    <button id="send">Request login link</button>
  </div>

  <pre id="out"></pre>

  <script>
    document.getElementById('send').addEventListener('click', async () => {
      const email = document.getElementById('email').value;
      const res = await fetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const out = document.getElementById('out');
      if (!res.ok) {
        out.textContent = 'Failed: ' + (await res.text());
        return;
      }
      const data = await res.json();
      if (data.loginUrl) {
        out.innerHTML = 'Login link: <a href="' + data.loginUrl + '">' + data.loginUrl + '</a>';
      } else {
        out.textContent = 'If that email exists, a login link has been sent.';
      }
    });
  </script>
</body>
</html>`;
}

export function renderDashboardHome({ email }: DashboardPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>clawdbot-projects dashboard</title>
  <style>${baseCss()}</style>
</head>
<body>
  <h1>Dashboard</h1>
  <p>Logged in as <code>${email}</code></p>

  <div class="card">
    <div class="row">
      <a href="/dashboard/work-items">Work items</a>
      <span class="muted">|</span>
      <a href="/dashboard/inbox">Inbox</a>
    </div>
  </div>

  <p class="muted">Tip: start at <a href="/dashboard/work-items">Work items</a> to create/edit tasks, manage dependencies, and participants/watchers.</p>
</body>
</html>`;
}

export function renderInbox({ email }: DashboardPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Inbox - clawdbot-projects</title>
  <style>${baseCss()}</style>
</head>
<body>
  <div class="row" style="justify-content:space-between">
    <div>
      <h1>Inbox</h1>
      <p class="muted">Logged in as <code>${email}</code></p>
    </div>
    <div class="row">
      <a href="/dashboard">Home</a>
      <a href="/dashboard/work-items">Work items</a>
    </div>
  </div>

  <table>
    <thead><tr><th>Title</th><th>Action</th><th>Channel</th><th>Thread</th><th>Last message</th></tr></thead>
    <tbody id="inbox"></tbody>
  </table>

  <script>
    ${baseScript()}

    async function refresh() {
      const inboxRes = await fetch('/api/inbox');
      const inbox = await inboxRes.json();
      document.getElementById('inbox').innerHTML = inbox.items.map(i =>
        '<tr>' +
          '<td><a href="/dashboard/work-items/' + i.work_item_id + '">' + escapeHtml(i.title) + '</a></td>' +
          '<td>' + escapeHtml(i.action) + '</td>' +
          '<td>' + escapeHtml(i.channel) + '</td>' +
          '<td>' + escapeHtml(i.external_thread_key) + '</td>' +
          '<td>' + escapeHtml(i.last_message_body || '') + '</td>' +
        '</tr>'
      ).join('');
    }

    refresh();
  </script>
</body>
</html>`;
}

export function renderWorkItemsList({ email }: DashboardPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Work items - clawdbot-projects</title>
  <style>${baseCss()}</style>
</head>
<body>
  <div class="row" style="justify-content:space-between">
    <div>
      <h1>Work items</h1>
      <p class="muted">Logged in as <code>${email}</code></p>
    </div>
    <div class="row">
      <a href="/dashboard">Home</a>
      <a href="/dashboard/inbox">Inbox</a>
      <a href="/dashboard/work-items/new">New</a>
    </div>
  </div>

  <table>
    <thead><tr><th>Title</th><th>Status</th><th>Priority</th><th>Type</th><th>Updated</th></tr></thead>
    <tbody id="items"></tbody>
  </table>

  <script>
    ${baseScript()}

    async function refresh() {
      const res = await fetch('/api/work-items');
      const data = await res.json();
      document.getElementById('items').innerHTML = data.items.map(i =>
        '<tr>' +
          '<td><a href="/dashboard/work-items/' + i.id + '">' + escapeHtml(i.title) + '</a></td>' +
          '<td><span class="pill">' + escapeHtml(i.status) + '</span></td>' +
          '<td>' + escapeHtml(i.priority) + '</td>' +
          '<td>' + escapeHtml(i.task_type) + '</td>' +
          '<td class="muted">' + new Date(i.updated_at).toLocaleString() + '</td>' +
        '</tr>'
      ).join('');
    }

    refresh();
  </script>
</body>
</html>`;
}

export function renderWorkItemNew({ email }: DashboardPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>New work item - clawdbot-projects</title>
  <style>${baseCss()}</style>
</head>
<body>
  <div class="row" style="justify-content:space-between">
    <div>
      <h1>New work item</h1>
      <p class="muted">Logged in as <code>${email}</code></p>
    </div>
    <div class="row">
      <a href="/dashboard/work-items">Back</a>
    </div>
  </div>

  <div class="card">
    <div class="row">
      <input id="title" placeholder="Title" size="60" />
    </div>
    <div style="margin-top:10px">
      <textarea id="description" placeholder="Description (optional)" rows="6"></textarea>
    </div>
    <div class="row" style="margin-top:10px">
      <button id="create">Create</button>
      <span id="out" class="muted"></span>
    </div>
  </div>

  <script>
    document.getElementById('create').addEventListener('click', async () => {
      const title = document.getElementById('title').value;
      const description = document.getElementById('description').value;
      const res = await fetch('/api/work-items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, description })
      });
      if (!res.ok) {
        document.getElementById('out').textContent = 'Failed: ' + (await res.text());
        return;
      }
      const item = await res.json();
      window.location.href = '/dashboard/work-items/' + item.id;
    });
  </script>
</body>
</html>`;
}

export function renderWorkItemDetail({ email }: DashboardPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Work item - clawdbot-projects</title>
  <style>${baseCss()}</style>
</head>
<body>
  <div class="row" style="justify-content:space-between">
    <div>
      <h1 id="heading">Work item</h1>
      <p class="muted">Logged in as <code>${email}</code></p>
    </div>
    <div class="row">
      <a href="/dashboard/work-items">Work items</a>
      <a href="/dashboard/inbox">Inbox</a>
    </div>
  </div>

  <div class="card">
    <h2>Details</h2>
    <div class="row">
      <input id="title" placeholder="Title" size="60" />
      <select id="status">
        <option value="open">open</option>
        <option value="closed">closed</option>
        <option value="blocked">blocked</option>
      </select>
      <select id="priority">
        <option value="P0">P0</option>
        <option value="P1">P1</option>
        <option value="P2">P2</option>
        <option value="P3">P3</option>
        <option value="P4">P4</option>
      </select>
      <select id="taskType">
        <option value="general">general</option>
        <option value="coding">coding</option>
        <option value="admin">admin</option>
        <option value="ops">ops</option>
        <option value="research">research</option>
        <option value="meeting">meeting</option>
      </select>
    </div>
    <div style="margin-top:10px">
      <textarea id="description" placeholder="Description" rows="8"></textarea>
    </div>
    <div class="row" style="margin-top:10px">
      <label class="muted">Not before <input type="datetime-local" id="notBefore" /></label>
      <label class="muted">Not after <input type="datetime-local" id="notAfter" /></label>
    </div>
    <div class="row" style="margin-top:10px">
      <button id="save">Save</button>
      <button id="delete" class="danger">Delete</button>
      <span id="out" class="muted"></span>
    </div>
  </div>

  <div class="card">
    <h2>Dependencies</h2>
    <div class="row">
      <select id="depTarget"></select>
      <button id="addDep">Add dependency</button>
      <span class="muted">(blocks this work item until complete)</span>
    </div>
    <table style="margin-top:10px">
      <thead><tr><th>Depends on</th><th>Kind</th><th></th></tr></thead>
      <tbody id="deps"></tbody>
    </table>
  </div>

  <div class="card">
    <h2>Participants / Watchers</h2>
    <div class="row">
      <input id="participant" placeholder="name or email" size="30" />
      <select id="role">
        <option value="participant">participant</option>
        <option value="watcher">watcher</option>
      </select>
      <button id="addParticipant">Attach</button>
      <span id="pout" class="muted"></span>
    </div>

    <table style="margin-top:10px">
      <thead><tr><th>Participant</th><th>Role</th><th></th></tr></thead>
      <tbody id="participants"></tbody>
    </table>
  </div>

  <script>
    ${baseScript()}

    const workItemId = window.location.pathname.split('/').pop();

    async function load() {
      const res = await fetch('/api/work-items/' + workItemId);
      if (!res.ok) {
        document.getElementById('out').textContent = 'Not found';
        return;
      }
      const wi = await res.json();
      document.getElementById('heading').textContent = wi.title;
      document.getElementById('title').value = wi.title || '';
      document.getElementById('status').value = wi.status || 'open';
      document.getElementById('priority').value = wi.priority || 'P2';
      document.getElementById('taskType').value = wi.task_type || 'general';
      document.getElementById('description').value = wi.description || '';
      document.getElementById('notBefore').value = isoOrEmpty(wi.not_before);
      document.getElementById('notAfter').value = isoOrEmpty(wi.not_after);

      const [depsRes, partsRes, listRes] = await Promise.all([
        fetch('/api/work-items/' + workItemId + '/dependencies'),
        fetch('/api/work-items/' + workItemId + '/participants'),
        fetch('/api/work-items')
      ]);

      const deps = await depsRes.json();
      document.getElementById('deps').innerHTML = deps.items.map(d =>
        '<tr>' +
          '<td><a href="/dashboard/work-items/' + d.depends_on_work_item_id + '">' + escapeHtml(d.depends_on_title) + '</a></td>' +
          '<td>' + escapeHtml(d.kind) + '</td>' +
          '<td><button data-dep="' + d.id + '" class="removeDep">Remove</button></td>' +
        '</tr>'
      ).join('');

      const parts = await partsRes.json();
      document.getElementById('participants').innerHTML = parts.items.map(p =>
        '<tr>' +
          '<td>' + escapeHtml(p.participant) + '</td>' +
          '<td>' + escapeHtml(p.role) + '</td>' +
          '<td><button data-participant="' + p.id + '" class="removeParticipant">Remove</button></td>' +
        '</tr>'
      ).join('');

      const list = await listRes.json();
      const options = list.items
        .filter(i => i.id !== workItemId)
        .map(i => '<option value="' + i.id + '">' + escapeHtml(i.title) + ' (' + i.id.slice(0,8) + ')</option>')
        .join('');
      document.getElementById('depTarget').innerHTML = '<option value="">Select work item…</option>' + options;

      document.querySelectorAll('.removeDep').forEach(btn => btn.addEventListener('click', async (e) => {
        const depId = e.target.getAttribute('data-dep');
        await fetch('/api/work-items/' + workItemId + '/dependencies/' + depId, { method: 'DELETE' });
        await load();
      }));

      document.querySelectorAll('.removeParticipant').forEach(btn => btn.addEventListener('click', async (e) => {
        const pid = e.target.getAttribute('data-participant');
        await fetch('/api/work-items/' + workItemId + '/participants/' + pid, { method: 'DELETE' });
        await load();
      }));
    }

    document.getElementById('save').addEventListener('click', async () => {
      const payload = {
        title: document.getElementById('title').value,
        description: document.getElementById('description').value,
        status: document.getElementById('status').value,
        priority: document.getElementById('priority').value,
        taskType: document.getElementById('taskType').value,
        notBefore: document.getElementById('notBefore').value ? new Date(document.getElementById('notBefore').value).toISOString() : null,
        notAfter: document.getElementById('notAfter').value ? new Date(document.getElementById('notAfter').value).toISOString() : null,
      };
      const res = await fetch('/api/work-items/' + workItemId, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        document.getElementById('out').textContent = 'Failed: ' + (await res.text());
        return;
      }
      document.getElementById('out').textContent = 'Saved';
      await load();
    });

    document.getElementById('delete').addEventListener('click', async () => {
      if (!confirm('Delete this work item? This cannot be undone.')) return;
      const res = await fetch('/api/work-items/' + workItemId, { method: 'DELETE' });
      if (!res.ok) {
        document.getElementById('out').textContent = 'Failed: ' + (await res.text());
        return;
      }
      window.location.href = '/dashboard/work-items';
    });

    document.getElementById('addDep').addEventListener('click', async () => {
      const dependsOnWorkItemId = document.getElementById('depTarget').value;
      if (!dependsOnWorkItemId) return;
      const res = await fetch('/api/work-items/' + workItemId + '/dependencies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dependsOnWorkItemId, kind: 'depends_on' })
      });
      if (!res.ok) {
        document.getElementById('out').textContent = 'Failed: ' + (await res.text());
        return;
      }
      await load();
    });

    document.getElementById('addParticipant').addEventListener('click', async () => {
      const participant = document.getElementById('participant').value;
      const role = document.getElementById('role').value;
      const res = await fetch('/api/work-items/' + workItemId + '/participants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ participant, role })
      });
      if (!res.ok) {
        document.getElementById('pout').textContent = 'Failed: ' + (await res.text());
        return;
      }
      document.getElementById('participant').value = '';
      document.getElementById('pout').textContent = '';
      await load();
    });

    load();
  </script>
</body>
</html>`;
}
