const $ = (sel) => document.querySelector(sel);

let currentProject = null;

async function api(path, opts) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function refreshHealth() {
  try {
    const h = await api("/health");
    $("#gemma-status").className = h.gemma ? "up" : "down";
    $("#gemma-status").title = h.gemma ? "Gemma 연결됨" : "llama-server 꺼짐";
  } catch {
    $("#gemma-status").className = "down";
  }
}

async function loadProjects() {
  const projects = await api("/projects");
  const ul = $("#project-list");
  ul.innerHTML = "";
  for (const p of projects) {
    const li = document.createElement("li");
    li.textContent = p.name;
    li.classList.toggle("active", currentProject?.id === p.id);
    li.onclick = () => openProject(p.id);
    ul.appendChild(li);
  }
}

async function openProject(id) {
  const { project, docs, messages } = await api(`/projects/${id}`);
  currentProject = project;
  $("#new-doc").disabled = false;
  $("#chat-input").disabled = false;
  $("#send").disabled = false;

  const dl = $("#doc-list");
  dl.innerHTML = "";
  const kindLabel = { research: "조사", world: "세계관", note: "노트" };
  for (const d of docs) {
    const li = document.createElement("li");
    li.textContent = `[${kindLabel[d.kind]}] ${d.title}`;
    li.onclick = async () => {
      const full = await api(`/projects/${id}/docs/${d.id}`);
      $("#doc-view-title").textContent = full.title;
      $("#doc-view-content").textContent = full.content;
      $("#doc-view").showModal();
    };
    dl.appendChild(li);
  }

  const log = $("#chat-log");
  log.innerHTML = "";
  for (const m of messages) appendMessage(m.role, m.content);
  log.scrollTop = log.scrollHeight;
  loadProjects();
}

function appendMessage(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = content;
  $("#chat-log").appendChild(div);
  return div;
}

async function sendMessage(text) {
  appendMessage("user", text);
  const assistantDiv = appendMessage("assistant", "");
  assistantDiv.classList.add("streaming");
  const log = $("#chat-log");
  log.scrollTop = log.scrollHeight;

  const res = await fetch(`/api/projects/${currentProject.id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      const evt = JSON.parse(data);
      if (evt.error) assistantDiv.textContent = `⚠ ${evt.error}`;
      if (evt.delta) assistantDiv.textContent += evt.delta;
      log.scrollTop = log.scrollHeight;
    }
  }
  assistantDiv.classList.remove("streaming");
}

$("#new-project").onclick = async () => {
  const name = prompt("프로젝트 이름:");
  if (!name) return;
  const brief = prompt("기획 메모 (한 줄이라도, 나중에 수정 가능):") ?? "";
  const p = await api("/projects", { method: "POST", body: JSON.stringify({ name, brief }) });
  await loadProjects();
  openProject(p.id);
};

$("#new-doc").onclick = async () => {
  const kind = prompt("종류 (research/world/note):", "note");
  if (!["research", "world", "note"].includes(kind)) return alert("research/world/note 중 하나");
  const title = prompt("제목:");
  if (!title) return;
  const content = prompt("내용:");
  if (content == null) return;
  await api(`/projects/${currentProject.id}/docs`, {
    method: "POST",
    body: JSON.stringify({ kind, title, content }),
  });
  openProject(currentProject.id);
};

$("#chat-form").onsubmit = (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text || !currentProject) return;
  input.value = "";
  sendMessage(text);
};

$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
});

loadProjects();
refreshHealth();
setInterval(refreshHealth, 15000);
