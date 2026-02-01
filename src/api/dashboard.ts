type DashboardPageOptions = {
  email: string;
};

type DashboardShellOptions = {
  title: string;
  email?: string;
  mainHtml: string;
};

function renderShell({ title, email, mainHtml }: DashboardShellOptions): string {
  const userBadge = email
    ? `<div class="text-sm text-muted-foreground">Logged in as <code class="rounded bg-muted px-1.5 py-0.5">${email}</code></div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="/static/app.css" />
</head>
<body class="min-h-screen">
  <div data-testid="app-shell" class="min-h-screen">
    <header class="border-b bg-background">
      <div class="container-page flex h-14 items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <a href="/dashboard" class="font-semibold">Projects</a>
          <nav aria-label="Primary" class="hidden gap-3 text-sm md:flex">
            <a href="/dashboard/work-items" class="text-muted-foreground hover:text-foreground">Work items</a>
            <a href="/dashboard/inbox" class="text-muted-foreground hover:text-foreground">Inbox</a>
          </nav>
        </div>
        ${userBadge}
      </div>
    </header>

    <main class="container-page py-6">
      ${mainHtml}
    </main>
  </div>
</body>
</html>`;
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
  return renderShell({
    title: 'clawdbot-projects login',
    mainHtml: `
      <div class="mx-auto max-w-xl">
        <h1 class="text-2xl font-semibold tracking-tight">Dashboard login</h1>
        <p class="mt-2 text-sm text-muted-foreground">Request a magic link (15 minutes). Check your email for the sign-in link.</p>

        <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label class="sr-only" for="email">Email</label>
          <input id="email" placeholder="you@example.com" class="h-10 w-full rounded-md border bg-background px-3 text-sm shadow-sm" />
          <button id="send" class="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90">Request login link</button>
        </div>

        <pre id="out" class="mt-4 whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs text-muted-foreground"></pre>
      </div>

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
            out.innerHTML = 'Login link: <a class="underline" href="' + data.loginUrl + '">' + data.loginUrl + '</a>';
          } else {
            out.textContent = 'If that email exists, a login link has been sent.';
          }
        });
      </script>
    `,
  });
}

export function renderDashboardHome({ email }: DashboardPageOptions): string {
  return renderShell({
    title: 'clawdbot-projects dashboard',
    email,
    mainHtml: `
      <h1 class="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p class="mt-1 text-sm text-muted-foreground">Tip: start at <a class="underline" href="/dashboard/work-items">Work items</a> to create/edit tasks, manage dependencies, and participants/watchers.</p>

      <div class="mt-6 grid gap-3 sm:grid-cols-2">
        <a class="rounded-lg border bg-background p-4 shadow-sm hover:bg-muted" href="/dashboard/work-items">
          <div class="font-medium">Work items</div>
          <div class="mt-1 text-sm text-muted-foreground">Create, edit, and manage tasks</div>
        </a>
        <a class="rounded-lg border bg-background p-4 shadow-sm hover:bg-muted" href="/dashboard/inbox">
          <div class="font-medium">Inbox</div>
          <div class="mt-1 text-sm text-muted-foreground">Messages linked to work items</div>
        </a>
      </div>
    `,
  });
}

export function renderInbox({ email }: DashboardPageOptions): string {
  return renderShell({
    title: 'Inbox - clawdbot-projects',
    email,
    mainHtml: `
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p class="mt-1 text-sm text-muted-foreground">Messages linked to work items.</p>
        </div>
      </div>

      <div class="mt-6 overflow-x-auto rounded-lg border">
        <table class="min-w-full text-sm">
          <thead class="bg-muted text-left text-muted-foreground">
            <tr>
              <th class="px-3 py-2 font-medium">Title</th>
              <th class="px-3 py-2 font-medium">Action</th>
              <th class="px-3 py-2 font-medium">Channel</th>
              <th class="px-3 py-2 font-medium">Thread</th>
              <th class="px-3 py-2 font-medium">Last message</th>
            </tr>
          </thead>
          <tbody id="inbox" class="divide-y"></tbody>
        </table>
      </div>

      <script>
        ${baseScript()}

        async function refresh() {
          const inboxRes = await fetch('/api/inbox');
          const inbox = await inboxRes.json();
          document.getElementById('inbox').innerHTML = inbox.items.map(i =>
            '<tr>' +
              '<td class="px-3 py-2"><a class="underline" href="/dashboard/work-items/' + i.work_item_id + '">' + escapeHtml(i.title) + '</a></td>' +
              '<td class="px-3 py-2">' + escapeHtml(i.action) + '</td>' +
              '<td class="px-3 py-2">' + escapeHtml(i.channel) + '</td>' +
              '<td class="px-3 py-2">' + escapeHtml(i.external_thread_key) + '</td>' +
              '<td class="px-3 py-2">' + escapeHtml(i.last_message_body || '') + '</td>' +
            '</tr>'
          ).join('');
        }

        refresh();
      </script>
    `,
  });
}

export function renderWorkItemsList({ email }: DashboardPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Work items - clawdbot-projects</title>
  <link rel="stylesheet" href="/static/app.css" />
</head>
<body class="min-h-screen">
  <div data-testid="app-shell" class="min-h-screen">
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
    <thead><tr><th>Title</th><th>Status</th><th>Priority</th><th>Type</th><th>Est.</th><th>Actual</th><th>Updated</th></tr></thead>
    <tbody id="items"></tbody>
  </table>

  <script>
    ${baseScript()}

    function formatMinutes(m) {
      if (m == null) return '—';
      if (m < 60) return m + 'm';
      const h = Math.floor(m / 60);
      const rm = m % 60;
      return rm > 0 ? h + 'h ' + rm + 'm' : h + 'h';
    }

    async function refresh() {
      const res = await fetch('/api/work-items');
      const data = await res.json();
      document.getElementById('items').innerHTML = data.items.map(i =>
        '<tr>' +
          '<td><a href="/dashboard/work-items/' + i.id + '">' + escapeHtml(i.title) + '</a></td>' +
          '<td><span class="pill">' + escapeHtml(i.status) + '</span></td>' +
          '<td>' + escapeHtml(i.priority) + '</td>' +
          '<td>' + escapeHtml(i.task_type) + '</td>' +
          '<td>' + formatMinutes(i.estimate_minutes) + '</td>' +
          '<td>' + formatMinutes(i.actual_minutes) + '</td>' +
          '<td class="muted">' + new Date(i.updated_at).toLocaleString() + '</td>' +
        '</tr>'
      ).join('');
    }

    refresh();
  </script>
  </div>
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
  <link rel="stylesheet" href="/static/app.css" />
</head>
<body class="min-h-screen">
  <div data-testid="app-shell" class="min-h-screen">
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
  </div>
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
  <link rel="stylesheet" href="/static/app.css" />
</head>
<body class="min-h-screen">
  <div data-testid="app-shell" class="min-h-screen">
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
      <label class="muted">Estimate (mins) <input type="number" id="estimateMinutes" min="0" max="525600" style="width:80px" /></label>
      <label class="muted">Actual (mins) <input type="number" id="actualMinutes" min="0" max="525600" style="width:80px" /></label>
    </div>
    <div class="row" style="margin-top:10px">
      <button id="save">Save</button>
      <button id="delete" class="danger">Delete</button>
      <span id="out" class="muted"></span>
    </div>
  </div>

  <div class="card" id="rollupCard" style="display:none">
    <h2>Effort Rollup</h2>
    <p class="muted">Total estimates and actuals across this item and all descendants.</p>
    <div class="row" style="margin-top:10px">
      <span><strong>Total Estimate:</strong> <span id="rollupEstimate">—</span></span>
      <span><strong>Total Actual:</strong> <span id="rollupActual">—</span></span>
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

    function formatMinutes(m) {
      if (m == null) return '—';
      if (m < 60) return m + 'm';
      const h = Math.floor(m / 60);
      const rm = m % 60;
      return rm > 0 ? h + 'h ' + rm + 'm' : h + 'h';
    }

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
      document.getElementById('estimateMinutes').value = wi.estimate_minutes != null ? wi.estimate_minutes : '';
      document.getElementById('actualMinutes').value = wi.actual_minutes != null ? wi.actual_minutes : '';

      // Load and display rollup data
      const rollupRes = await fetch('/api/work-items/' + workItemId + '/rollup');
      if (rollupRes.ok) {
        const rollup = await rollupRes.json();
        document.getElementById('rollupCard').style.display = 'block';
        document.getElementById('rollupEstimate').textContent = formatMinutes(rollup.total_estimate_minutes);
        document.getElementById('rollupActual').textContent = formatMinutes(rollup.total_actual_minutes);
      }

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
      const estVal = document.getElementById('estimateMinutes').value;
      const actVal = document.getElementById('actualMinutes').value;
      const payload = {
        title: document.getElementById('title').value,
        description: document.getElementById('description').value,
        status: document.getElementById('status').value,
        priority: document.getElementById('priority').value,
        taskType: document.getElementById('taskType').value,
        notBefore: document.getElementById('notBefore').value ? new Date(document.getElementById('notBefore').value).toISOString() : null,
        notAfter: document.getElementById('notAfter').value ? new Date(document.getElementById('notAfter').value).toISOString() : null,
        estimateMinutes: estVal !== '' ? parseInt(estVal, 10) : null,
        actualMinutes: actVal !== '' ? parseInt(actVal, 10) : null,
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
  </div>
</body>
</html>`;
}
