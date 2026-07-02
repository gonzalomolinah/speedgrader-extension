"use strict";

const connectionText = document.getElementById("connectionText");
const totalValue = document.getElementById("totalValue");
const editButton = document.getElementById("editButton");
const insertButton = document.getElementById("insertButton");
const clearButton = document.getElementById("clearButton");
const statusPanel = document.getElementById("statusPanel");
const addSectionForm = document.getElementById("addSectionForm");
const sectionNameInput = document.getElementById("sectionNameInput");
const addSectionButton = document.getElementById("addSectionButton");
const sectionsList = document.getElementById("sectionsList");

let socket = null;
let reconnectTimer = null;
let latestState = null;
let openedOnce = false;
let remoteEditMode = false;
let editingSectionId = null;
let editingCriterionId = null;

editButton.addEventListener("click", () => {
  remoteEditMode = !remoteEditMode;
  editingSectionId = null;
  editingCriterionId = null;
  updateEditModeUi();
  renderState(latestState);
});

insertButton.addEventListener("click", () => {
  sendMessage({ type: "remote:insertGrade" });
  setStatus("Solicitud enviada a la rubrica de Canvas.", "success");
});

clearButton.addEventListener("click", () => {
  sendMessage({ type: "remote:clearSelection" });
});

addSectionForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = sectionNameInput.value.trim();

  if (!name) {
    setStatus("Ingresa un nombre para la seccion.", "error");
    sectionNameInput.focus();
    return;
  }

  if (sendMessage({ type: "remote:addSection", name })) {
    sectionNameInput.value = "";
    setStatus("Seccion enviada a Canvas.", "success");
  }
});

updateEditModeUi();
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
    sectionsList.appendChild(renderSection(section));
  });
}

function renderSection(section) {
  const block = document.createElement("article");
  block.className = "section-block";

  const criteria = Array.isArray(section.criteria) ? section.criteria : [];

  if (remoteEditMode && editingSectionId === section.id) {
    block.appendChild(renderSectionEditForm(section));
  } else {
    block.appendChild(renderSectionHeader(section, criteria));
  }

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

  if (remoteEditMode) {
    block.appendChild(renderAddCriterionForm(section));
  }

  return block;
}

function renderSectionHeader(section, criteria) {
  const header = document.createElement("header");
  header.className = "section-header";

  if (!remoteEditMode && criteria.length > 0) {
    header.setAttribute("role", "checkbox");
    header.setAttribute("tabindex", isSocketReady() ? "0" : "-1");
    header.setAttribute("aria-checked", getSectionSelectionState(criteria));
    header.setAttribute("aria-disabled", isSocketReady() ? "false" : "true");
    header.setAttribute("aria-label", `Alternar toda la seccion ${section.name || "Seccion"}`);
    header.addEventListener("click", () => {
      toggleSectionCriteria(section, criteria);
    });
    header.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      toggleSectionCriteria(section, criteria);
    });
  }

  const titleWrap = document.createElement("div");
  titleWrap.className = "section-title-wrap";

  const name = document.createElement("strong");
  name.className = "section-name";
  name.textContent = section.name || "Seccion";

  const subtotal = document.createElement("span");
  subtotal.className = "section-subtotal";
  subtotal.textContent = `${section.subtotal || "0"} pts`;

  titleWrap.append(name, subtotal);
  header.appendChild(titleWrap);

  if (remoteEditMode) {
    const actions = document.createElement("div");
    actions.className = "item-actions";

    const editSectionButton = document.createElement("button");
    editSectionButton.type = "button";
    editSectionButton.className = "small-button";
    editSectionButton.textContent = "Editar";
    editSectionButton.addEventListener("click", () => {
      editingSectionId = section.id;
      editingCriterionId = null;
      renderState(latestState);
    });

    const deleteSectionButton = document.createElement("button");
    deleteSectionButton.type = "button";
    deleteSectionButton.className = "small-button danger-button";
    deleteSectionButton.textContent = "Eliminar";
    deleteSectionButton.addEventListener("click", () => {
      if (criteria.length > 0 && !window.confirm("Eliminar esta seccion y sus criterios?")) {
        return;
      }

      sendMessage({
        type: "remote:deleteSection",
        sectionId: section.id
      });
    });

    actions.append(editSectionButton, deleteSectionButton);
    header.appendChild(actions);
  }

  return header;
}

function renderSectionEditForm(section) {
  const form = document.createElement("form");
  form.className = "section-header section-edit-form";

  const input = document.createElement("input");
  input.type = "text";
  input.value = section.name || "";
  input.setAttribute("aria-label", "Editar nombre de la seccion");

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "small-button save-button";
  saveButton.textContent = "Guardar";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "small-button";
  cancelButton.textContent = "Cancelar";
  cancelButton.addEventListener("click", () => {
    editingSectionId = null;
    renderState(latestState);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = input.value.trim();

    if (!name) {
      setStatus("El nombre de la seccion no puede estar vacio.", "error");
      input.focus();
      return;
    }

    if (
      sendMessage({
        type: "remote:updateSection",
        sectionId: section.id,
        name
      })
    ) {
      editingSectionId = null;
      renderState(latestState);
    }
  });

  form.append(input, saveButton, cancelButton);
  requestAnimationFrame(() => input.focus());

  return form;
}

function renderCriterion(section, criterion) {
  if (remoteEditMode && editingCriterionId === criterion.id) {
    return renderCriterionEditForm(section, criterion);
  }

  const row = document.createElement(remoteEditMode ? "div" : "label");
  row.className = remoteEditMode ? "criterion-row criterion-row-with-actions" : "criterion-row";

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

  if (remoteEditMode) {
    const actions = document.createElement("div");
    actions.className = "item-actions";

    const editCriterionButton = document.createElement("button");
    editCriterionButton.type = "button";
    editCriterionButton.className = "small-button";
    editCriterionButton.textContent = "Editar";
    editCriterionButton.addEventListener("click", () => {
      editingSectionId = null;
      editingCriterionId = criterion.id;
      renderState(latestState);
    });

    const deleteCriterionButton = document.createElement("button");
    deleteCriterionButton.type = "button";
    deleteCriterionButton.className = "small-button danger-button";
    deleteCriterionButton.textContent = "Eliminar";
    deleteCriterionButton.addEventListener("click", () => {
      sendMessage({
        type: "remote:deleteCriterion",
        sectionId: section.id,
        criterionId: criterion.id
      });
    });

    actions.append(editCriterionButton, deleteCriterionButton);
    row.appendChild(actions);
  }

  return row;
}

function renderCriterionEditForm(section, criterion) {
  const form = document.createElement("form");
  form.className = "criterion-row criterion-row-editing";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = criterion.name || "";
  nameInput.setAttribute("aria-label", "Editar nombre del criterio");

  const pointsInput = document.createElement("input");
  pointsInput.type = "number";
  pointsInput.step = "0.01";
  pointsInput.min = "0";
  pointsInput.value = criterion.points || "0";
  pointsInput.setAttribute("aria-label", "Editar puntos del criterio");

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "small-button save-button";
  saveButton.textContent = "Guardar";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "small-button";
  cancelButton.textContent = "Cancelar";
  cancelButton.addEventListener("click", () => {
    editingCriterionId = null;
    renderState(latestState);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = nameInput.value.trim();
    const points = parsePoints(pointsInput.value);

    if (!name) {
      setStatus("El nombre del criterio no puede estar vacio.", "error");
      nameInput.focus();
      return;
    }

    if (points === null) {
      setStatus("Ingresa un puntaje valido.", "error");
      pointsInput.focus();
      return;
    }

    if (
      sendMessage({
        type: "remote:updateCriterion",
        sectionId: section.id,
        criterionId: criterion.id,
        name,
        points
      })
    ) {
      editingCriterionId = null;
      renderState(latestState);
    }
  });

  form.append(nameInput, pointsInput, saveButton, cancelButton);
  requestAnimationFrame(() => nameInput.focus());

  return form;
}

function renderAddCriterionForm(section) {
  const form = document.createElement("form");
  form.className = "add-criterion-form";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Criterio";
  nameInput.setAttribute("aria-label", `Nuevo criterio para ${section.name || "seccion"}`);

  const pointsInput = document.createElement("input");
  pointsInput.type = "number";
  pointsInput.step = "0.01";
  pointsInput.min = "0";
  pointsInput.placeholder = "Pts";
  pointsInput.setAttribute("aria-label", `Puntos del nuevo criterio para ${section.name || "seccion"}`);

  const addButton = document.createElement("button");
  addButton.type = "submit";
  addButton.className = "small-button";
  addButton.textContent = "Agregar";

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = nameInput.value.trim();
    const points = parsePoints(pointsInput.value);

    if (!name) {
      setStatus("Ingresa un nombre para el criterio.", "error");
      nameInput.focus();
      return;
    }

    if (points === null) {
      setStatus("Ingresa un puntaje valido.", "error");
      pointsInput.focus();
      return;
    }

    if (
      sendMessage({
        type: "remote:addCriterion",
        sectionId: section.id,
        name,
        points
      })
    ) {
      nameInput.value = "";
      pointsInput.value = "";
      setStatus("Criterio enviado a Canvas.", "success");
    }
  });

  form.append(nameInput, pointsInput, addButton);

  return form;
}

function getSectionSelectionState(criteria) {
  const checkedCount = criteria.filter((criterion) => criterion.checked).length;

  if (checkedCount === 0) {
    return "false";
  }

  return checkedCount === criteria.length ? "true" : "mixed";
}

function toggleSectionCriteria(section, criteria) {
  const shouldCheck = criteria.some((criterion) => !criterion.checked);

  sendMessage({
    type: "remote:toggleSection",
    sectionId: section.id,
    checked: shouldCheck
  });
}

function sendMessage(message) {
  if (!isSocketReady()) {
    setStatus("Panel remoto desconectado.", "error");
    return false;
  }

  socket.send(JSON.stringify(message));
  return true;
}

function parsePoints(value) {
  const parsed = Number(String(value).trim().replace(",", "."));

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function setActionsEnabled(enabled) {
  const ready = enabled && isSocketReady();

  editButton.disabled = !ready;
  insertButton.disabled = !ready;
  clearButton.disabled = !ready;
  addSectionButton.disabled = !ready;
  sectionNameInput.disabled = !ready;

  sectionsList.querySelectorAll("button, input").forEach((control) => {
    control.disabled = !ready;
  });

  sectionsList.querySelectorAll('.section-header[role="checkbox"]').forEach((header) => {
    header.setAttribute("aria-disabled", ready ? "false" : "true");
    header.setAttribute("tabindex", ready ? "0" : "-1");
  });
}

function updateEditModeUi() {
  editButton.textContent = remoteEditMode ? "Cerrar edicion" : "Editar pauta";
  editButton.setAttribute("aria-pressed", remoteEditMode ? "true" : "false");
  addSectionForm.hidden = !remoteEditMode;
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
