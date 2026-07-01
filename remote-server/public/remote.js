"use strict";

const connectionText = document.getElementById("connectionText");
const totalValue = document.getElementById("totalValue");
const insertButton = document.getElementById("insertButton");
const clearButton = document.getElementById("clearButton");
const statusPanel = document.getElementById("statusPanel");
const sectionsList = document.getElementById("sectionsList");

let socket = null;
let reconnectTimer = null;
let latestState = null;
let openedOnce = false;

insertButton.addEventListener("click", () => {
  sendMessage({ type: "remote:insertGrade" });
  setStatus("Solicitud enviada a Canvas.", "success");
});

clearButton.addEventListener("click", () => {
  sendMessage({ type: "remote:clearSelection" });
});

setActionsEnabled(false);
connectSocket();

function connectSocket() {
  clearReconnectTimer();

  if (socket) {
    socket.close();
    socket = null;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/remote`);
  setConnection("Conectando");

  socket.addEventListener("open", () => {
    openedOnce = true;
    setConnection("Conectado");
    setActionsEnabled(Boolean(latestState));
  });

  socket.addEventListener("message", (event) => {
    let message = null;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    handleMessage(message);
  });

  socket.addEventListener("close", () => {
    socket = null;
    setActionsEnabled(false);

    if (!openedOnce) {
      setConnection("No conectado");
      setStatus("No se pudo conectar con el servidor local.", "error");
      scheduleReconnect();
      return;
    }

    setConnection("Reconectando");
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    setActionsEnabled(false);
  });
}

function handleMessage(message) {
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "server:hello") {
    if (!message.extensionConnected) {
      setConnection("Esperando extension");
    }
    return;
  }

  if (message.type === "extension:state") {
    latestState = message.state;
    renderState(latestState);
    setActionsEnabled(true);
    setConnection("Conectado");
    return;
  }

  if (message.type === "extension:status") {
    setStatus(message.status?.message || "", message.status?.type || "neutral");
    return;
  }

  if (message.type === "server:extension-disconnected") {
    setConnection("Extension desconectada");
    setActionsEnabled(false);
    return;
  }

  if (message.type === "server:error") {
    setStatus(message.message || "Error remoto.", "error");
  }
}

function renderState(state) {
  totalValue.textContent = state?.total || "0";
  sectionsList.textContent = "";

  const sections = Array.isArray(state?.sections) ? state.sections : [];

  if (sections.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Sin secciones.";
    sectionsList.appendChild(empty);
    return;
  }

  sections.forEach((section) => {
    const block = document.createElement("article");
    block.className = "section-block";

    const header = document.createElement("header");
    header.className = "section-header";

    const name = document.createElement("strong");
    name.className = "section-name";
    name.textContent = section.name || "Seccion";

    const subtotal = document.createElement("span");
    subtotal.className = "section-subtotal";
    subtotal.textContent = `${section.subtotal || "0"} pts`;

    header.append(name, subtotal);
    block.appendChild(header);

    const criteria = Array.isArray(section.criteria) ? section.criteria : [];

    if (criteria.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Sin criterios.";
      block.appendChild(empty);
    } else {
      criteria.forEach((criterion) => {
        block.appendChild(renderCriterion(section, criterion));
      });
    }

    sectionsList.appendChild(block);
  });
}

function renderCriterion(section, criterion) {
  const row = document.createElement("label");
  row.className = "criterion-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(criterion.checked);
  checkbox.disabled = !isSocketReady();
  checkbox.addEventListener("change", () => {
    sendMessage({
      type: "remote:toggleCriterion",
      sectionId: section.id,
      criterionId: criterion.id,
      checked: checkbox.checked
    });
  });

  const name = document.createElement("span");
  name.className = "criterion-name";
  name.textContent = criterion.name || "Criterio";

  const points = document.createElement("span");
  points.className = "criterion-points";
  points.textContent = `${criterion.points || "0"} pts`;

  row.append(checkbox, name, points);

  return row;
}

function sendMessage(message) {
  if (!isSocketReady()) {
    setStatus("Panel remoto desconectado.", "error");
    return false;
  }

  socket.send(JSON.stringify(message));
  return true;
}

function setActionsEnabled(enabled) {
  const ready = enabled && isSocketReady();

  insertButton.disabled = !ready;
  clearButton.disabled = !ready;

  sectionsList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.disabled = !ready;
  });
}

function setConnection(text) {
  connectionText.textContent = text;
}

function setStatus(message, type) {
  statusPanel.textContent = message || "";
  statusPanel.dataset.type = type || "neutral";
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectSocket();
  }, 1500);
}

function clearReconnectTimer() {
  if (!reconnectTimer) {
    return;
  }

  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function isSocketReady() {
  return socket?.readyState === WebSocket.OPEN;
}
