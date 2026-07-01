(function () {
  "use strict";

  const PANEL_ID = "canvas-corrector-helper-panel";
  const LAUNCHER_ID = "canvas-corrector-helper-launcher";
  const STORAGE_PREFIX = "canvasCorrector";
  const URL_CHECK_INTERVAL_MS = 1000;
  const REMOTE_SERVER_URL = "ws://127.0.0.1:8787/extension";
  const REMOTE_RECONNECT_DELAY_MS = 1500;
  const GRADE_KEYWORDS = ["calificacion", "grade", "score", "puntaje", "puntos"];
  const INPUT_TYPES = new Set(["", "text", "number", "tel", "search"]);
  const BLOCKED_INPUT_TYPES = new Set([
    "button",
    "checkbox",
    "color",
    "date",
    "datetime-local",
    "email",
    "file",
    "hidden",
    "image",
    "month",
    "password",
    "radio",
    "range",
    "reset",
    "submit",
    "time",
    "url",
    "week"
  ]);

  let sections = [];
  let editingSectionId = null;
  let editingCriterionId = null;
  let currentUrl = window.location.href;
  let currentStorageKey = null;
  let isPanelClosed = false;
  let panelEl = null;
  let launcherEl = null;
  let listEl = null;
  let totalEl = null;
  let statusEl = null;
  let addSectionNameInput = null;
  let remoteEnabled = false;
  let remoteSocket = null;
  let remoteReconnectTimer = null;
  let remoteServerInfo = null;
  let remoteToggleButton = null;
  let remoteStatusEl = null;
  let remoteUrlEl = null;

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return `cch-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  function defaultSections() {
    return [
      {
        id: makeId(),
        name: "Parte A",
        criteria: [
          { id: makeId(), name: "Area correcta", points: 15, checked: false },
          { id: makeId(), name: "Dominio correcto", points: 10, checked: false },
          { id: makeId(), name: "Integral bien planteada", points: 20, checked: false }
        ]
      },
      {
        id: makeId(),
        name: "Parte B",
        criteria: [
          { id: makeId(), name: "Resultado final", points: 10, checked: false },
          { id: makeId(), name: "Justificacion", points: 5, checked: false }
        ]
      }
    ];
  }

  function init() {
    if (!isSpeedGraderPage()) {
      stopRemoteMode();
      removePanel();
      removeLauncher();
      isPanelClosed = false;
      return;
    }

    if (document.getElementById(PANEL_ID)) {
      return;
    }

    currentStorageKey = getStorageKey();

    loadRubric()
      .then((loadedSections) => {
        sections = loadedSections;
        if (isPanelClosed) {
          createLauncher();
          broadcastRemoteState();
        } else {
          createPanel();
          renderCriteria();
          calculateTotal();
          setStatus("Listo para corregir.", "neutral");
          broadcastRemoteState();
        }
      })
      .catch(() => {
        sections = defaultSections();
        if (isPanelClosed) {
          createLauncher();
          broadcastRemoteState();
        } else {
          createPanel();
          renderCriteria();
          calculateTotal();
          setStatus("No se pudo cargar el guardado. Usando criterios por defecto.", "error");
          broadcastRemoteState();
        }
      });
  }

  function isSpeedGraderPage() {
    return window.location.href.includes("speed_grader");
  }

  function createPanel() {
    removeLauncher();

    panelEl = document.createElement("aside");
    panelEl.id = PANEL_ID;
    panelEl.setAttribute("aria-label", "Corrector Canvas");

    const header = document.createElement("div");
    header.className = "cch-header";

    const title = document.createElement("h2");
    title.textContent = "Corrector Canvas";

    const headerActions = document.createElement("div");
    headerActions.className = "cch-header-actions";

    const badge = document.createElement("span");
    badge.className = "cch-badge";
    badge.textContent = "MVP";

    const closeButton = document.createElement("button");
    closeButton.className = "cch-close-button";
    closeButton.type = "button";
    closeButton.textContent = "Cerrar";
    closeButton.setAttribute("aria-label", "Cerrar Corrector Canvas");
    closeButton.addEventListener("click", closePanel);

    headerActions.append(badge, closeButton);
    header.append(title, headerActions);

    const criteriaSection = document.createElement("section");
    criteriaSection.className = "cch-section cch-criteria-section";

    const criteriaTitle = document.createElement("div");
    criteriaTitle.className = "cch-section-title";
    criteriaTitle.textContent = "Secciones y criterios";

    listEl = document.createElement("div");
    listEl.className = "cch-sections-list";

    criteriaSection.append(criteriaTitle, listEl);

    const addSectionBlock = document.createElement("section");
    addSectionBlock.className = "cch-section";

    const addSectionTitle = document.createElement("div");
    addSectionTitle.className = "cch-section-title";
    addSectionTitle.textContent = "Agregar seccion";

    const addSectionForm = document.createElement("div");
    addSectionForm.className = "cch-add-section-form";

    addSectionNameInput = document.createElement("input");
    addSectionNameInput.className = "cch-input";
    addSectionNameInput.type = "text";
    addSectionNameInput.placeholder = "Ej: Parte C";
    addSectionNameInput.setAttribute("aria-label", "Nombre de la seccion");

    const addSectionButton = document.createElement("button");
    addSectionButton.className = "cch-button cch-button-primary";
    addSectionButton.type = "button";
    addSectionButton.textContent = "Agregar";
    addSectionButton.addEventListener("click", addSection);

    addSectionForm.append(addSectionNameInput, addSectionButton);
    addSectionBlock.append(addSectionTitle, addSectionForm);

    const remoteSection = createRemoteControls();

    const footer = document.createElement("footer");
    footer.className = "cch-footer";

    const totalRow = document.createElement("div");
    totalRow.className = "cch-total-row";

    const totalLabel = document.createElement("span");
    totalLabel.textContent = "Total";

    totalEl = document.createElement("strong");
    totalEl.className = "cch-total";
    totalEl.textContent = "0";

    totalRow.append(totalLabel, totalEl);

    const actions = document.createElement("div");
    actions.className = "cch-actions";

    const insertButton = document.createElement("button");
    insertButton.className = "cch-button cch-button-primary";
    insertButton.type = "button";
    insertButton.textContent = "Ingresar en Canvas";
    insertButton.addEventListener("click", insertGradeIntoCanvas);

    const copyButton = document.createElement("button");
    copyButton.className = "cch-button";
    copyButton.type = "button";
    copyButton.textContent = "Copiar total";
    copyButton.addEventListener("click", copyTotal);

    const clearButton = document.createElement("button");
    clearButton.className = "cch-button";
    clearButton.type = "button";
    clearButton.textContent = "Limpiar";
    clearButton.addEventListener("click", clearSelection);

    actions.append(insertButton, copyButton, clearButton);

    statusEl = document.createElement("div");
    statusEl.className = "cch-status";
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");

    footer.append(totalRow, actions, statusEl);
    panelEl.append(header, criteriaSection, addSectionBlock, remoteSection, footer);
    updateRemoteUi();

    panelEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      const sectionBlock = event.target.closest(".cch-section-block");

      if (event.target.closest(".cch-add-section-form")) {
        event.preventDefault();
        addSection();
        return;
      }

      if (sectionBlock && event.target.closest(".cch-add-criterion-form")) {
        event.preventDefault();
        addCriterion(sectionBlock.dataset.sectionId);
      }
    });

    document.body.appendChild(panelEl);
  }

  function createRemoteControls() {
    const remoteSection = document.createElement("section");
    remoteSection.className = "cch-section cch-remote-section";

    const remoteTitle = document.createElement("div");
    remoteTitle.className = "cch-section-title";
    remoteTitle.textContent = "Modo remoto";

    const remoteRow = document.createElement("div");
    remoteRow.className = "cch-remote-row";

    const remoteText = document.createElement("div");
    remoteText.className = "cch-remote-text";
    remoteText.textContent = "Panel para otro dispositivo en la misma red.";

    remoteToggleButton = document.createElement("button");
    remoteToggleButton.className = "cch-button cch-remote-toggle";
    remoteToggleButton.type = "button";
    remoteToggleButton.setAttribute("role", "switch");
    remoteToggleButton.addEventListener("click", toggleRemoteMode);

    remoteRow.append(remoteText, remoteToggleButton);

    remoteUrlEl = document.createElement("div");
    remoteUrlEl.className = "cch-remote-url";

    remoteStatusEl = document.createElement("div");
    remoteStatusEl.className = "cch-remote-status";
    remoteStatusEl.setAttribute("role", "status");
    remoteStatusEl.setAttribute("aria-live", "polite");

    remoteSection.append(remoteTitle, remoteRow, remoteUrlEl, remoteStatusEl);

    return remoteSection;
  }

  function createLauncher() {
    if (!isSpeedGraderPage()) {
      return;
    }

    const existingLauncher = document.getElementById(LAUNCHER_ID);

    if (existingLauncher) {
      launcherEl = existingLauncher;
      return;
    }

    launcherEl = document.createElement("button");
    launcherEl.id = LAUNCHER_ID;
    launcherEl.type = "button";
    launcherEl.textContent = "Abrir Corrector Canvas";
    launcherEl.setAttribute("aria-label", "Abrir Corrector Canvas");
    launcherEl.addEventListener("click", openPanel);
    document.body.appendChild(launcherEl);
  }

  function openPanel() {
    isPanelClosed = false;
    removeLauncher();

    if (!document.getElementById(PANEL_ID)) {
      createPanel();
      renderCriteria();
      calculateTotal();
      setStatus("Panel abierto.", "neutral");
    }
  }

  function closePanel() {
    isPanelClosed = true;
    removePanel();
    createLauncher();
  }

  function loadRubric() {
    const key = getStorageKey();

    return new Promise((resolve) => {
      if (!hasChromeStorage()) {
        resolve(defaultSections());
        return;
      }

      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError) {
          resolve(defaultSections());
          return;
        }

        const stored = result[key];

        if (stored === undefined) {
          resolve(defaultSections());
          return;
        }

        resolve(normalizeStoredRubric(stored));
      });
    });
  }

  function saveRubric() {
    const key = currentStorageKey || getStorageKey();
    const payload = {
      version: 2,
      sections: sections.map((section) => ({
        id: section.id || makeId(),
        name: section.name,
        criteria: section.criteria.map((criterion) => ({
          id: criterion.id || makeId(),
          name: criterion.name,
          points: criterion.points,
          checked: false
        }))
      })),
      updatedAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      if (!hasChromeStorage()) {
        resolve();
        return;
      }

      chrome.storage.local.set({ [key]: payload }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        resolve();
      });
    });
  }

  function renderCriteria() {
    if (!listEl) {
      return;
    }

    listEl.textContent = "";

    if (sections.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cch-empty";
      empty.textContent = "Aun no hay secciones.";
      listEl.appendChild(empty);
      calculateTotal();
      return;
    }

    sections.forEach((section) => {
      const sectionBlock = document.createElement("div");
      sectionBlock.className = "cch-section-block";
      sectionBlock.dataset.sectionId = section.id;

      renderSectionHeader(sectionBlock, section);
      renderSectionCriteria(sectionBlock, section);
      renderAddCriterionForm(sectionBlock, section);
      listEl.appendChild(sectionBlock);
    });

    calculateTotal();
  }

  function renderSectionHeader(sectionBlock, section) {
    const header = document.createElement("div");
    header.className = "cch-section-header";

    if (editingSectionId === section.id) {
      renderEditingSectionHeader(header, section);
      sectionBlock.appendChild(header);
      return;
    }

    const titleWrap = document.createElement("div");
    titleWrap.className = "cch-section-name-wrap";

    const name = document.createElement("strong");
    name.className = "cch-section-name";
    name.textContent = section.name;

    const subtotal = document.createElement("span");
    subtotal.className = "cch-section-subtotal";
    subtotal.dataset.sectionId = section.id;
    subtotal.textContent = `${formatNumber(calculateSectionTotal(section))} pts`;

    titleWrap.append(name, subtotal);

    const actions = document.createElement("div");
    actions.className = "cch-section-actions";

    const editButton = document.createElement("button");
    editButton.className = "cch-icon-button";
    editButton.type = "button";
    editButton.textContent = "Editar";
    editButton.addEventListener("click", () => {
      editingSectionId = section.id;
      editingCriterionId = null;
      renderCriteria();
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "cch-icon-button cch-danger";
    deleteButton.type = "button";
    deleteButton.textContent = "Eliminar";
    deleteButton.addEventListener("click", () => deleteSection(section.id));

    actions.append(editButton, deleteButton);
    header.append(titleWrap, actions);
    sectionBlock.appendChild(header);
  }

  function renderEditingSectionHeader(header, section) {
    header.classList.add("cch-section-header-editing");

    const nameInput = document.createElement("input");
    nameInput.className = "cch-input";
    nameInput.type = "text";
    nameInput.value = section.name;
    nameInput.setAttribute("aria-label", "Editar nombre de la seccion");

    const saveButton = document.createElement("button");
    saveButton.className = "cch-icon-button cch-save";
    saveButton.type = "button";
    saveButton.textContent = "Guardar";
    saveButton.addEventListener("click", () => editSection(section.id, nameInput.value));

    const cancelButton = document.createElement("button");
    cancelButton.className = "cch-icon-button";
    cancelButton.type = "button";
    cancelButton.textContent = "Cancelar";
    cancelButton.addEventListener("click", () => {
      editingSectionId = null;
      renderCriteria();
    });

    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        editSection(section.id, nameInput.value);
      }

      if (event.key === "Escape") {
        event.preventDefault();
        editingSectionId = null;
        renderCriteria();
      }
    });

    header.append(nameInput, saveButton, cancelButton);
    requestAnimationFrame(() => nameInput.focus());
  }

  function renderSectionCriteria(sectionBlock, section) {
    const criteriaList = document.createElement("div");
    criteriaList.className = "cch-criteria-list";

    if (section.criteria.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cch-empty cch-empty-small";
      empty.textContent = "Sin criterios en esta seccion.";
      criteriaList.appendChild(empty);
    } else {
      section.criteria.forEach((criterion) => {
        const row = document.createElement("div");
        row.className = "cch-criterion-row";
        row.dataset.criterionId = criterion.id;

        if (editingCriterionId === criterion.id) {
          renderEditingCriterionRow(row, section, criterion);
        } else {
          renderReadOnlyCriterionRow(row, section, criterion);
        }

        criteriaList.appendChild(row);
      });
    }

    sectionBlock.appendChild(criteriaList);
  }

  function renderReadOnlyCriterionRow(row, section, criterion) {
    const checkbox = document.createElement("input");
    checkbox.className = "cch-checkbox";
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(criterion.checked);
    checkbox.setAttribute("aria-label", `Marcar ${criterion.name}`);
    checkbox.addEventListener("change", () => {
      criterion.checked = checkbox.checked;
      calculateTotal();
      broadcastRemoteState();
    });

    const name = document.createElement("span");
    name.className = "cch-criterion-name";
    name.textContent = criterion.name;

    const points = document.createElement("span");
    points.className = "cch-criterion-points";
    points.textContent = formatNumber(criterion.points);

    const editButton = document.createElement("button");
    editButton.className = "cch-icon-button";
    editButton.type = "button";
    editButton.textContent = "Editar";
    editButton.addEventListener("click", () => {
      editingSectionId = null;
      editingCriterionId = criterion.id;
      renderCriteria();
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "cch-icon-button cch-danger";
    deleteButton.type = "button";
    deleteButton.textContent = "Eliminar";
    deleteButton.addEventListener("click", () => deleteCriterion(section.id, criterion.id));

    row.append(checkbox, name, points, editButton, deleteButton);
  }

  function renderEditingCriterionRow(row, section, criterion) {
    row.classList.add("cch-criterion-row-editing");

    const nameInput = document.createElement("input");
    nameInput.className = "cch-input cch-edit-name";
    nameInput.type = "text";
    nameInput.value = criterion.name;
    nameInput.setAttribute("aria-label", "Editar nombre del criterio");

    const pointsInput = document.createElement("input");
    pointsInput.className = "cch-input cch-edit-points";
    pointsInput.type = "number";
    pointsInput.step = "0.01";
    pointsInput.min = "0";
    pointsInput.value = formatNumber(criterion.points);
    pointsInput.setAttribute("aria-label", "Editar puntos del criterio");

    const saveButton = document.createElement("button");
    saveButton.className = "cch-icon-button cch-save";
    saveButton.type = "button";
    saveButton.textContent = "Guardar";
    saveButton.addEventListener("click", () => {
      editCriterion(section.id, criterion.id, nameInput.value, pointsInput.value);
    });

    const cancelButton = document.createElement("button");
    cancelButton.className = "cch-icon-button";
    cancelButton.type = "button";
    cancelButton.textContent = "Cancelar";
    cancelButton.addEventListener("click", () => {
      editingCriterionId = null;
      renderCriteria();
    });

    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        editCriterion(section.id, criterion.id, nameInput.value, pointsInput.value);
      }

      if (event.key === "Escape") {
        event.preventDefault();
        editingCriterionId = null;
        renderCriteria();
      }
    });

    row.append(nameInput, pointsInput, saveButton, cancelButton);
    requestAnimationFrame(() => nameInput.focus());
  }

  function renderAddCriterionForm(sectionBlock, section) {
    const form = document.createElement("div");
    form.className = "cch-add-criterion-form";

    const nameInput = document.createElement("input");
    nameInput.className = "cch-input";
    nameInput.type = "text";
    nameInput.placeholder = "Criterio";
    nameInput.setAttribute("aria-label", `Nuevo criterio para ${section.name}`);

    const pointsInput = document.createElement("input");
    pointsInput.className = "cch-input cch-points-input";
    pointsInput.type = "number";
    pointsInput.step = "0.01";
    pointsInput.min = "0";
    pointsInput.placeholder = "Pts";
    pointsInput.setAttribute("aria-label", `Puntos del nuevo criterio para ${section.name}`);

    const addButton = document.createElement("button");
    addButton.className = "cch-button";
    addButton.type = "button";
    addButton.textContent = "Agregar criterio";
    addButton.addEventListener("click", () => addCriterion(section.id));

    form.append(nameInput, pointsInput, addButton);
    sectionBlock.appendChild(form);
  }

  function calculateTotal() {
    let total = 0;

    sections.forEach((section) => {
      const sectionTotal = calculateSectionTotal(section);
      const subtotalEl = panelEl?.querySelector(
        `.cch-section-subtotal[data-section-id="${section.id}"]`
      );

      if (subtotalEl) {
        subtotalEl.textContent = `${formatNumber(sectionTotal)} pts`;
      }

      total += sectionTotal;
    });

    if (totalEl) {
      totalEl.textContent = formatNumber(total);
    }

    return total;
  }

  function calculateSectionTotal(section) {
    return section.criteria.reduce((sum, criterion) => {
      if (!criterion.checked) {
        return sum;
      }

      return sum + Number(criterion.points || 0);
    }, 0);
  }

  function toggleRemoteMode() {
    if (remoteEnabled) {
      stopRemoteMode();
      return;
    }

    startRemoteMode();
  }

  function startRemoteMode() {
    remoteEnabled = true;
    updateRemoteUi();
    setRemoteStatus("Conectando con el servidor local...", "neutral");
    connectRemoteSocket();
  }

  function stopRemoteMode() {
    remoteEnabled = false;
    remoteServerInfo = null;
    clearRemoteReconnectTimer();

    if (remoteSocket) {
      const socket = remoteSocket;
      remoteSocket = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;

      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, "remote mode disabled");
      }
    }

    updateRemoteUi();
    setRemoteStatus("Modo remoto desactivado.", "neutral");
  }

  function connectRemoteSocket() {
    if (!remoteEnabled) {
      return;
    }

    if (
      remoteSocket &&
      (remoteSocket.readyState === WebSocket.OPEN ||
        remoteSocket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    clearRemoteReconnectTimer();

    try {
      remoteSocket = new WebSocket(REMOTE_SERVER_URL);
    } catch (error) {
      remoteSocket = null;
      setRemoteStatus("No se pudo crear la conexion remota.", "error");
      scheduleRemoteReconnect();
      return;
    }

    remoteSocket.addEventListener("open", () => {
      updateRemoteUi();
      setRemoteStatus("Servidor local conectado. Esperando panel remoto.", "success");
      sendRemoteMessage("extension:hello", { state: getRemoteState() });
      broadcastRemoteState();
    });

    remoteSocket.addEventListener("message", (event) => {
      let message = null;

      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }

      handleRemoteMessage(message);
    });

    remoteSocket.addEventListener("close", () => {
      remoteSocket = null;
      updateRemoteUi();

      if (!remoteEnabled) {
        return;
      }

      setRemoteStatus("Servidor local desconectado. Reintentando...", "error");
      scheduleRemoteReconnect();
    });

    remoteSocket.addEventListener("error", () => {
      if (remoteEnabled) {
        setRemoteStatus("No se pudo conectar con el servidor local.", "error");
      }
    });
  }

  function scheduleRemoteReconnect() {
    if (!remoteEnabled || remoteReconnectTimer) {
      return;
    }

    remoteReconnectTimer = window.setTimeout(() => {
      remoteReconnectTimer = null;
      connectRemoteSocket();
    }, REMOTE_RECONNECT_DELAY_MS);
  }

  function clearRemoteReconnectTimer() {
    if (!remoteReconnectTimer) {
      return;
    }

    window.clearTimeout(remoteReconnectTimer);
    remoteReconnectTimer = null;
  }

  function handleRemoteMessage(message) {
    if (!message || typeof message.type !== "string") {
      return;
    }

    if (message.type === "server:hello") {
      remoteServerInfo = {
        urls: Array.isArray(message.urls) ? message.urls : []
      };
      updateRemoteUi();
      broadcastRemoteState();
      return;
    }

    if (message.type === "server:remote-count") {
      const count = Number(message.count || 0);
      const suffix = count === 1 ? "1 panel remoto conectado." : `${count} paneles remotos conectados.`;
      setRemoteStatus(suffix, "success");
      return;
    }

    if (message.type === "remote:toggleCriterion") {
      applyRemoteCriterionToggle(message.sectionId, message.criterionId, message.checked);
      return;
    }

    if (message.type === "remote:clearSelection") {
      clearSelection({ source: "remote" });
      return;
    }

    if (message.type === "remote:insertGrade") {
      insertGradeIntoCanvas();
    }
  }

  function applyRemoteCriterionToggle(sectionId, criterionId, checked) {
    const section = sections.find((item) => item.id === sectionId);
    const criterion = section?.criteria.find((item) => item.id === criterionId);

    if (!section || !criterion) {
      setStatus("El panel remoto intento marcar un criterio que ya no existe.", "error");
      broadcastRemoteState();
      return;
    }

    criterion.checked = Boolean(checked);
    renderCriteria();
    calculateTotal();
    broadcastRemoteState();
  }

  function broadcastRemoteState() {
    sendRemoteMessage("extension:state", { state: getRemoteState() });
  }

  function sendRemoteStatus(message, type) {
    sendRemoteMessage("extension:status", {
      status: {
        message,
        type
      }
    });
  }

  function sendRemoteMessage(type, payload) {
    if (
      !remoteEnabled ||
      !remoteSocket ||
      remoteSocket.readyState !== WebSocket.OPEN
    ) {
      return false;
    }

    remoteSocket.send(
      JSON.stringify({
        type,
        ...payload
      })
    );

    return true;
  }

  function getRemoteState() {
    return {
      total: formatNumber(calculateTotal()),
      sections: sections.map((section) => ({
        id: section.id,
        name: section.name,
        subtotal: formatNumber(calculateSectionTotal(section)),
        criteria: section.criteria.map((criterion) => ({
          id: criterion.id,
          name: criterion.name,
          points: formatNumber(criterion.points),
          checked: Boolean(criterion.checked)
        }))
      })),
      page: {
        title: document.title,
        url: window.location.href
      },
      updatedAt: new Date().toISOString()
    };
  }

  function updateRemoteUi() {
    if (remoteToggleButton) {
      remoteToggleButton.textContent = remoteEnabled ? "Desactivar" : "Activar";
      remoteToggleButton.classList.toggle("cch-button-primary", remoteEnabled);
      remoteToggleButton.setAttribute("aria-checked", remoteEnabled ? "true" : "false");
    }

    if (remoteUrlEl) {
      if (!remoteEnabled) {
        remoteUrlEl.textContent = "Ejecuta node remote-server/server.js y activa este modo.";
      } else if (remoteServerInfo?.urls?.length > 0) {
        const url = remoteServerInfo.urls[0];
        remoteUrlEl.textContent = url;
      } else {
        remoteUrlEl.textContent = "Servidor local: ws://127.0.0.1:8787";
      }
    }
  }

  function setRemoteStatus(message, type) {
    if (!remoteStatusEl) {
      return;
    }

    remoteStatusEl.textContent = message;
    remoteStatusEl.dataset.type = type;
  }

  function addSection() {
    const name = addSectionNameInput.value.trim();

    if (!name) {
      setStatus("Ingresa un nombre para la seccion.", "error");
      addSectionNameInput.focus();
      return;
    }

    sections.push({
      id: makeId(),
      name,
      criteria: []
    });

    addSectionNameInput.value = "";
    editingSectionId = null;
    editingCriterionId = null;
    renderCriteria();
    broadcastRemoteState();

    saveRubric()
      .then(() => setStatus("Seccion agregada.", "success"))
      .catch(() => setStatus("No se pudo guardar la seccion.", "error"));
  }

  function editSection(sectionId, nameValue) {
    const section = sections.find((item) => item.id === sectionId);

    if (!section) {
      setStatus("No se encontro la seccion a editar.", "error");
      return;
    }

    const name = String(nameValue || "").trim();

    if (!name) {
      setStatus("El nombre de la seccion no puede estar vacio.", "error");
      return;
    }

    section.name = name;
    editingSectionId = null;
    renderCriteria();
    broadcastRemoteState();

    saveRubric()
      .then(() => setStatus("Seccion actualizada.", "success"))
      .catch(() => setStatus("No se pudo guardar el cambio.", "error"));
  }

  function deleteSection(sectionId) {
    const section = sections.find((item) => item.id === sectionId);

    if (!section) {
      setStatus("No se encontro la seccion a eliminar.", "error");
      return;
    }

    if (section.criteria.length > 0 && !window.confirm("Eliminar esta seccion y sus criterios?")) {
      return;
    }

    sections = sections.filter((item) => item.id !== sectionId);

    if (editingSectionId === sectionId) {
      editingSectionId = null;
    }

    if (section.criteria.some((criterion) => criterion.id === editingCriterionId)) {
      editingCriterionId = null;
    }

    renderCriteria();
    broadcastRemoteState();

    saveRubric()
      .then(() => setStatus("Seccion eliminada.", "success"))
      .catch(() => setStatus("No se pudo guardar la eliminacion.", "error"));
  }

  function addCriterion(sectionId) {
    const section = sections.find((item) => item.id === sectionId);

    if (!section) {
      setStatus("No se encontro la seccion para agregar el criterio.", "error");
      return;
    }

    const sectionBlock = panelEl.querySelector(`.cch-section-block[data-section-id="${sectionId}"]`);
    const form = sectionBlock?.querySelector(".cch-add-criterion-form");
    const nameInput = form?.querySelector('input[type="text"]');
    const pointsInput = form?.querySelector('input[type="number"]');
    const name = String(nameInput?.value || "").trim();
    const points = parsePoints(pointsInput?.value);

    if (!name) {
      setStatus("Ingresa un nombre para el criterio.", "error");
      nameInput?.focus();
      return;
    }

    if (points === null) {
      setStatus("Ingresa un puntaje valido.", "error");
      pointsInput?.focus();
      return;
    }

    section.criteria.push({
      id: makeId(),
      name,
      points,
      checked: false
    });

    editingSectionId = null;
    editingCriterionId = null;
    renderCriteria();
    broadcastRemoteState();

    saveRubric()
      .then(() => setStatus("Criterio agregado.", "success"))
      .catch(() => setStatus("No se pudo guardar el criterio.", "error"));
  }

  function editCriterion(sectionId, criterionId, nameValue, pointsValue) {
    const section = sections.find((item) => item.id === sectionId);
    const criterion = section?.criteria.find((item) => item.id === criterionId);

    if (!section || !criterion) {
      setStatus("No se encontro el criterio a editar.", "error");
      return;
    }

    const name = String(nameValue || "").trim();
    const points = parsePoints(pointsValue);

    if (!name) {
      setStatus("El nombre del criterio no puede estar vacio.", "error");
      return;
    }

    if (points === null) {
      setStatus("El puntaje debe ser un numero valido.", "error");
      return;
    }

    criterion.name = name;
    criterion.points = points;
    editingCriterionId = null;
    renderCriteria();
    broadcastRemoteState();

    saveRubric()
      .then(() => setStatus("Criterio actualizado.", "success"))
      .catch(() => setStatus("No se pudo guardar el cambio.", "error"));
  }

  function deleteCriterion(sectionId, criterionId) {
    const section = sections.find((item) => item.id === sectionId);

    if (!section) {
      setStatus("No se encontro la seccion del criterio.", "error");
      return;
    }

    section.criteria = section.criteria.filter((criterion) => criterion.id !== criterionId);

    if (editingCriterionId === criterionId) {
      editingCriterionId = null;
    }

    renderCriteria();
    broadcastRemoteState();

    saveRubric()
      .then(() => setStatus("Criterio eliminado.", "success"))
      .catch(() => setStatus("No se pudo guardar la eliminacion.", "error"));
  }

  function clearSelection(options = {}) {
    sections = sections.map((section) => ({
      ...section,
      criteria: section.criteria.map((criterion) => ({
        ...criterion,
        checked: false
      }))
    }));

    renderCriteria();
    broadcastRemoteState();
    setStatus(
      options.source === "remote" ? "Seleccion limpiada desde el panel remoto." : "Seleccion limpiada.",
      "success"
    );
  }

  function copyTotal() {
    const totalText = formatNumber(calculateTotal());

    copyText(totalText)
      .then(() => setStatus(`Total copiado: ${totalText}`, "success"))
      .catch(() => setStatus("No se pudo copiar el total.", "error"));
  }

  function findGradeInput() {
    const scoredCandidates = Array.from(document.querySelectorAll("input"))
      .filter(isUsableGradeInput)
      .filter((input) => !isRubricCriterionInput(input))
      .map((input) => scoreGradeInput(input))
      .sort((a, b) => b.score - a.score);

    if (scoredCandidates.length === 0) {
      return null;
    }

    const keywordMatch = scoredCandidates.find(
      (candidate) => candidate.hasAttributeKeyword || candidate.hasNearbyKeyword
    );

    if (keywordMatch) {
      return keywordMatch.input;
    }

    const rightSideMatch = scoredCandidates.find((candidate) => candidate.isRightSide);

    if (rightSideMatch) {
      return rightSideMatch.input;
    }

    const contextualMatch = scoredCandidates.find((candidate) => candidate.score >= 55);

    return contextualMatch ? contextualMatch.input : null;
  }

  function insertGradeIntoCanvas() {
    const input = findGradeInput();
    const totalText = formatNumber(calculateTotal());
    const sectionResult = insertSectionScoresIntoCanvas();

    if (!input) {
      if (sectionResult.written > 0) {
        setStatus(
          `Subtotales ingresados (${sectionResult.written}/${sectionResult.expected}). No se encontro el total.`,
          "error"
        );
        return;
      }

      setStatus("No se encontro el input de puntaje visible en SpeedGrader.", "error");
      return;
    }

    input.focus();
    setNativeValue(input, totalText);
    input.dispatchEvent(new Event("blur", { bubbles: true }));

    if (sectionResult.found === 0) {
      setStatus(`Puntaje ${totalText} ingresado. Revisa antes de entregar.`, "success");
      return;
    }

    if (sectionResult.written < sectionResult.expected) {
      setStatus(
        `Total ${totalText} ingresado; subtotales ${sectionResult.written}/${sectionResult.expected}.`,
        "error"
      );
      return;
    }

    setStatus(
      `Total ${totalText} y ${sectionResult.written} subtotales ingresados. Revisa antes de entregar.`,
      "success"
    );
  }

  function insertSectionScoresIntoCanvas() {
    const sectionScores = sections
      .filter((section) => section.criteria.length > 0)
      .map((section) => ({
        id: section.id,
        name: section.name,
        total: calculateSectionTotal(section)
      }));
    const rubricInputs = findRubricCriterionInputs();
    const count = Math.min(sectionScores.length, rubricInputs.length);

    for (let index = 0; index < count; index += 1) {
      const value = formatNumber(sectionScores[index].total);
      const input = rubricInputs[index];

      setNativeValue(input, value);
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    return {
      expected: sectionScores.length,
      found: rubricInputs.length,
      written: count
    };
  }

  function findRubricCriterionInputs() {
    return Array.from(document.querySelectorAll("input"))
      .filter(isUsableRubricCriterionInput)
      .map((input) => ({
        input,
        rect: input.getBoundingClientRect(),
        score: scoreRubricCriterionInput(input)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => {
        const topDiff = a.rect.top - b.rect.top;

        if (Math.abs(topDiff) > 8) {
          return topDiff;
        }

        return a.rect.left - b.rect.left;
      })
      .map((candidate) => candidate.input);
  }

  function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function getStorageKey() {
    const url = new URL(window.location.href);
    const courseMatch = url.pathname.match(/\/courses\/([^/]+)/);
    const assignmentId = url.searchParams.get("assignment_id");

    if (courseMatch && courseMatch[1] && assignmentId) {
      return `${STORAGE_PREFIX}:${courseMatch[1]}:${assignmentId}`;
    }

    return `${STORAGE_PREFIX}:default`;
  }

  function normalizeStoredRubric(stored) {
    if (Array.isArray(stored?.sections)) {
      return normalizeSections(stored.sections);
    }

    if (Array.isArray(stored?.criteria)) {
      return [
        {
          id: makeId(),
          name: "General",
          criteria: normalizeCriteria(stored.criteria)
        }
      ];
    }

    if (Array.isArray(stored)) {
      return [
        {
          id: makeId(),
          name: "General",
          criteria: normalizeCriteria(stored)
        }
      ];
    }

    return defaultSections();
  }

  function normalizeSections(storedSections) {
    return storedSections
      .map((section) => {
        const name = String(section?.name || "").trim();

        if (!name) {
          return null;
        }

        return {
          id: section.id || makeId(),
          name,
          criteria: normalizeCriteria(section.criteria)
        };
      })
      .filter(Boolean);
  }

  function normalizeCriteria(storedCriteria) {
    if (!Array.isArray(storedCriteria)) {
      return [];
    }

    return storedCriteria
      .map((criterion) => {
        const points = parsePoints(criterion?.points);
        const name = String(criterion?.name || "").trim();

        if (!name || points === null) {
          return null;
        }

        return {
          id: criterion.id || makeId(),
          name,
          points,
          checked: false
        };
      })
      .filter(Boolean);
  }

  function hasChromeStorage() {
    return (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === "function" &&
      typeof chrome.storage.local.set === "function"
    );
  }

  function parsePoints(value) {
    const parsed = Number(String(value).trim().replace(",", "."));

    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }

    return parsed;
  }

  function formatNumber(value) {
    const number = Number(value || 0);
    const rounded = Math.round((number + Number.EPSILON) * 10000) / 10000;

    if (Object.is(rounded, -0)) {
      return "0";
    }

    return String(rounded);
  }

  function isUsableGradeInput(input) {
    if (input.closest(`#${PANEL_ID}`)) {
      return false;
    }

    const type = (input.getAttribute("type") || "text").toLowerCase();

    if (BLOCKED_INPUT_TYPES.has(type) || !INPUT_TYPES.has(type)) {
      return false;
    }

    if (input.disabled || input.readOnly || input.getAttribute("aria-disabled") === "true") {
      return false;
    }

    return isVisible(input);
  }

  function isUsableRubricCriterionInput(input) {
    if (input.closest(`#${PANEL_ID}`)) {
      return false;
    }

    const type = (input.getAttribute("type") || "text").toLowerCase();

    if (BLOCKED_INPUT_TYPES.has(type) || !INPUT_TYPES.has(type)) {
      return false;
    }

    if (input.disabled || input.readOnly || input.getAttribute("aria-disabled") === "true") {
      return false;
    }

    return isRendered(input) && isRubricCriterionInput(input);
  }

  function isRubricCriterionInput(input) {
    const text = getInputContextText(input);
    const hasCriterionScoreText =
      text.includes("puntaje de criterio") ||
      text.includes("criterion score") ||
      text.includes("criterio");
    const hasPointsLimit =
      /\/\s*\d+([.,]\d+)?\s*(puntos|pts|points)?/.test(text) ||
      text.includes("agregar comentario");

    return hasCriterionScoreText && hasPointsLimit && hasRubricAncestor(input);
  }

  function scoreRubricCriterionInput(input) {
    const text = getInputContextText(input);
    let score = 0;

    if (text.includes("puntaje de criterio")) score += 80;
    if (text.includes("criterion score")) score += 80;
    if (text.includes("criterio")) score += 25;
    if (/\/\s*\d+([.,]\d+)?\s*(puntos|pts|points)?/.test(text)) score += 25;
    if (text.includes("agregar comentario")) score += 12;
    if (hasRubricAncestor(input)) score += 25;

    return score;
  }

  function scoreGradeInput(input) {
    const rect = input.getBoundingClientRect();
    const viewportWidth = Math.max(window.innerWidth || 0, 1);
    const attrsText = normalizeText(
      [
        input.getAttribute("aria-label"),
        input.getAttribute("name"),
        input.id,
        input.placeholder,
        input.title,
        input.className
      ].join(" ")
    );
    const nearbyText = normalizeText(getNearbyText(input));
    const valueText = String(input.value || "").trim();
    const type = (input.getAttribute("type") || "text").toLowerCase();
    const hasAttributeKeyword = hasGradeKeyword(attrsText);
    const hasNearbyKeyword = hasGradeKeyword(nearbyText);
    const hasNumericValue = valueText === "" || isNumericText(valueText);
    const hasPointsContext = /\/\s*\d+([.,]\d+)?/.test(nearbyText) || nearbyText.includes("pts");
    const isReasonableWidth = rect.width >= 30 && rect.width <= 220;
    const isRightSide = rect.left >= viewportWidth * 0.45 || rect.right >= viewportWidth * 0.6;
    let score = 0;

    if (hasAttributeKeyword) score += 110;
    if (hasNearbyKeyword) score += 40;
    if (hasPointsContext) score += 24;
    if (type === "number") score += 18;
    if (type === "text" || type === "") score += 8;
    if (hasNumericValue) score += 16;
    if (isReasonableWidth) score += 20;
    if (rect.height >= 18 && rect.height <= 60) score += 8;
    if (isRightSide) score += 28;

    score += Math.min(30, Math.max(0, (rect.left / viewportWidth) * 30));

    return {
      input,
      score,
      hasAttributeKeyword,
      hasNearbyKeyword,
      isRightSide
    };
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      isRendered(element) &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  function isRendered(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function getNearbyText(input) {
    const parts = [];

    if (input.labels) {
      Array.from(input.labels).forEach((label) => parts.push(label.innerText));
    }

    const closestLabel = input.closest("label");
    if (closestLabel) {
      parts.push(closestLabel.innerText);
    }

    const parent = input.parentElement;
    const grandParent = parent ? parent.parentElement : null;
    const siblings = [input.previousElementSibling, input.nextElementSibling];

    if (parent) parts.push(parent.innerText);
    if (grandParent) parts.push(grandParent.innerText);

    siblings.forEach((sibling) => {
      if (sibling) {
        parts.push(sibling.innerText);
      }
    });

    return parts.join(" ").slice(0, 1000);
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function getInputContextText(input) {
    return normalizeText(
      [
        input.getAttribute("aria-label"),
        input.getAttribute("name"),
        input.id,
        input.placeholder,
        input.title,
        input.className,
        getNearbyText(input)
      ].join(" ")
    );
  }

  function hasRubricAncestor(input) {
    let node = input.parentElement;
    let depth = 0;

    while (node && depth < 8) {
      const text = normalizeText(
        [node.id, node.className, node.getAttribute("role"), node.getAttribute("aria-label")].join(
          " "
        )
      );

      if (text.includes("rubric") || text.includes("rubrica") || text.includes("criterio")) {
        return true;
      }

      node = node.parentElement;
      depth += 1;
    }

    return false;
  }

  function hasGradeKeyword(text) {
    const normalized = normalizeText(text);
    return GRADE_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)));
  }

  function isNumericText(value) {
    return /^-?\d+([.,]\d+)?$/.test(String(value).trim());
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.className = "cch-clipboard-helper";
      document.body.appendChild(textarea);
      textarea.select();

      try {
        const copied = document.execCommand("copy");
        textarea.remove();

        if (copied) {
          resolve();
        } else {
          reject(new Error("copy failed"));
        }
      } catch (error) {
        textarea.remove();
        reject(error);
      }
    });
  }

  function setStatus(message, type) {
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.dataset.type = type;
    }

    sendRemoteStatus(message, type);
  }

  function removePanel() {
    const existingPanel = document.getElementById(PANEL_ID);

    if (existingPanel) {
      existingPanel.remove();
    }

    panelEl = null;
    listEl = null;
    totalEl = null;
    statusEl = null;
    addSectionNameInput = null;
    remoteToggleButton = null;
    remoteStatusEl = null;
    remoteUrlEl = null;
    editingSectionId = null;
    editingCriterionId = null;
  }

  function removeLauncher() {
    const existingLauncher = document.getElementById(LAUNCHER_ID);

    if (existingLauncher) {
      existingLauncher.remove();
    }

    launcherEl = null;
  }

  function handleUrlChange() {
    if (window.location.href === currentUrl) {
      return;
    }

    currentUrl = window.location.href;
    removePanel();
    removeLauncher();
    sections = [];
    currentStorageKey = null;
    init();
  }

  function start() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }

    window.setInterval(handleUrlChange, URL_CHECK_INTERVAL_MS);
  }

  start();
})();
