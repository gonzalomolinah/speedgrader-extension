(function () {
  "use strict";

  const PANEL_ID = "canvas-corrector-helper-panel";
  const LAUNCHER_ID = "canvas-corrector-helper-launcher";
  const STORAGE_PREFIX = "canvasCorrector";
  const UNIVERSAL_RUBRIC_STORAGE_KEY = `${STORAGE_PREFIX}:rubric`;
  const PANEL_PREFS_KEY = `${STORAGE_PREFIX}:panelPreferences`;
  const URL_CHECK_INTERVAL_MS = 1000;
  const REMOTE_SERVER_URL = "ws://127.0.0.1:8787/extension";
  const REMOTE_RECONNECT_DELAY_MS = 1500;
  const SUBMIT_EVALUATION_RETRY_DELAY_MS = 200;
  const SUBMIT_EVALUATION_MAX_ATTEMPTS = 5;
  const RUBRIC_INPUT_WRITE_DELAY_MS = 120;
  const RUBRIC_COMMIT_CLICK_DELAY_MS = 100;
  const RUBRIC_BEFORE_SUBMIT_DELAY_MS = 180;
  const SHOW_SUBMIT_AND_EVALUATE_BUTTON = false;
  const PANEL_MIN_WIDTH = 220;
  const PANEL_MIN_HEIGHT = 360;
  const PANEL_COMPACT_WIDTH = 300;
  const PANEL_MARGIN = 8;
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
  const DEFAULT_SECTION_TEMPLATES = [
    {
      name: "3(a)",
      criteria: [
        { name: "Hallar f'(x)", points: 5 },
        { name: "Identificar el punto critico x = 1", points: 5 },
        { name: "Evaluar la funcion en los tres puntos candidatos", points: 10 },
        { name: "Conclusion correcta", points: 5 }
      ]
    },
    {
      name: "3(b)",
      criteria: [
        { name: "Plantear las ecuaciones de area y volumen", points: 5 },
        { name: "Obtener V(x)", points: 5 },
        { name: "Hallar V'(x) y el punto critico x = 20", points: 10 },
        { name: "Justificar que es un maximo absoluto", points: 10 },
        { name: "Calculo del volumen maximo", points: 5 }
      ]
    }
  ];
  const LEGACY_DEFAULT_SECTION_TEMPLATES = [
    {
      name: "Parte A",
      criteria: [
        { name: "Area correcta", points: 15 },
        { name: "Dominio correcto", points: 10 },
        { name: "Integral bien planteada", points: 20 }
      ]
    },
    {
      name: "Parte B",
      criteria: [
        { name: "Resultado final", points: 10 },
        { name: "Justificacion", points: 5 }
      ]
    }
  ];

  let sections = [];
  let editingSectionId = null;
  let editingCriterionId = null;
  let currentUrl = window.location.href;
  let currentStorageKey = null;
  let isPanelClosed = false;
  let isEditMode = false;
  let panelPosition = null;
  let panelDragState = null;
  let panelResizeState = null;
  let panelSize = loadPanelSizePreference();
  let panelEl = null;
  let launcherEl = null;
  let listEl = null;
  let totalEl = null;
  let statusEl = null;
  let addSectionNameInput = null;
  let editModeCheckbox = null;
  let remoteEnabled = false;
  let remoteSocket = null;
  let remoteReconnectTimer = null;
  let remoteServerInfo = null;
  let remoteControlsHidden = loadRemoteControlsHiddenPreference();
  let remoteSectionEl = null;
  let remoteRevealButton = null;
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

  function buildSectionsFromTemplate(sectionTemplates) {
    return sectionTemplates.map((section) => ({
      id: makeId(),
      name: section.name,
      criteria: section.criteria.map((criterion) => ({
        id: makeId(),
        name: criterion.name,
        points: criterion.points,
        checked: false
      }))
    }));
  }

  function defaultSections() {
    return buildSectionsFromTemplate(DEFAULT_SECTION_TEMPLATES);
  }

  function buildRubricPayload(sourceSections) {
    return {
      version: 3,
      sections: (sourceSections || []).map((section) => ({
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
  }

  function createRubricSignature(sourceSections) {
    return JSON.stringify(
      (sourceSections || []).map((section) => ({
        name: String(section?.name || "").trim(),
        criteria: (section?.criteria || []).map((criterion) => ({
          name: String(criterion?.name || "").trim(),
          points: parsePoints(criterion?.points)
        }))
      }))
    );
  }

  function rubricMatchesTemplate(sourceSections, sectionTemplates) {
    return (
      createRubricSignature(sourceSections) ===
      createRubricSignature(buildSectionsFromTemplate(sectionTemplates))
    );
  }

  function looksLikeLegacyDefaultRubric(sourceSections) {
    return rubricMatchesTemplate(sourceSections, LEGACY_DEFAULT_SECTION_TEMPLATES);
  }

  function persistRubricPayload(key, payload) {
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

  function loadPanelPreferences() {
    try {
      const raw = window.localStorage?.getItem(PANEL_PREFS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_error) {
      return {};
    }
  }

  function savePanelPreferences() {
    try {
      window.localStorage?.setItem(
        PANEL_PREFS_KEY,
        JSON.stringify({
          panelSize,
          remoteControlsHidden
        })
      );
    } catch (_error) {
      // Preference persistence is best-effort; the panel still works without it.
    }
  }

  function loadPanelSizePreference() {
    const size = loadPanelPreferences().panelSize;
    const width = Number(size?.width);
    const height = Number(size?.height);

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }

    return constrainPanelSize({ width, height });
  }

  function loadRemoteControlsHiddenPreference() {
    return Boolean(loadPanelPreferences().remoteControlsHidden);
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
    panelEl.dataset.editMode = String(isEditMode);
    panelEl.dataset.resized = String(Boolean(panelSize));
    panelEl.dataset.compactWidth = "false";

    const header = document.createElement("div");
    header.className = "cch-header";
    header.addEventListener("pointerdown", startPanelDrag);
    header.addEventListener("pointermove", movePanelDrag);
    header.addEventListener("pointerup", endPanelDrag);
    header.addEventListener("pointercancel", endPanelDrag);

    const title = document.createElement("h2");
    title.textContent = "Corrector Canvas";

    const headerActions = document.createElement("div");
    headerActions.className = "cch-header-actions";

    const editModeLabel = document.createElement("label");
    editModeLabel.className = "cch-edit-mode-label";

    editModeCheckbox = document.createElement("input");
    editModeCheckbox.type = "checkbox";
    editModeCheckbox.checked = isEditMode;
    editModeCheckbox.addEventListener("change", () => {
      setEditMode(editModeCheckbox.checked);
    });

    const editModeText = document.createElement("span");
    editModeText.textContent = "Editar";

    editModeLabel.append(editModeCheckbox, editModeText);

    const closeButton = document.createElement("button");
    closeButton.className = "cch-close-button";
    closeButton.type = "button";
    closeButton.textContent = "Cerrar";
    closeButton.setAttribute("aria-label", "Cerrar Corrector Canvas");
    closeButton.addEventListener("click", closePanel);

    headerActions.append(editModeLabel, closeButton);
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
    addSectionBlock.className = "cch-section cch-edit-only";

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

    const remoteSection = remoteControlsHidden ? null : createRemoteControls();

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
    insertButton.textContent = "Ingresar en rubrica";
    insertButton.addEventListener("click", insertGradeIntoCanvas);

    const clearButton = document.createElement("button");
    clearButton.className = "cch-button";
    clearButton.type = "button";
    clearButton.textContent = "Limpiar";
    clearButton.addEventListener("click", clearSelection);

    actions.append(insertButton);

    if (SHOW_SUBMIT_AND_EVALUATE_BUTTON) {
      const submitButton = document.createElement("button");
      submitButton.className = "cch-button";
      submitButton.type = "button";
      submitButton.textContent = "Ingresar y entregar evaluacion";
      submitButton.title = "Ingresa los subtotales y luego presiona Entregar evaluacion en Canvas";
      submitButton.classList.add("cch-button-long-label");
      submitButton.addEventListener("click", insertAndSubmitEvaluation);
      clearButton.classList.add("cch-button-full-row");
      actions.append(submitButton);
    }

    actions.append(clearButton);

    statusEl = document.createElement("div");
    statusEl.className = "cch-status";
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");

    footer.append(totalRow, actions, statusEl);
    panelEl.append(header, criteriaSection, addSectionBlock);

    if (remoteSection) {
      panelEl.append(remoteSection);
    }

    panelEl.append(footer);
    appendPanelResizeHandles(panelEl);
    updateRemoteUi();
    updateRemoteRevealButton();

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
    applyPanelSize();
    applyPanelPosition();
  }

  function setEditMode(enabled) {
    isEditMode = Boolean(enabled);
    editingSectionId = null;
    editingCriterionId = null;

    if (editModeCheckbox) {
      editModeCheckbox.checked = isEditMode;
    }

    if (panelEl) {
      panelEl.dataset.editMode = String(isEditMode);
    }

    renderCriteria();
    setStatus(isEditMode ? "Modo edicion activado." : "Modo correccion activado.", "neutral");
  }

  function startPanelDrag(event) {
    if (!panelEl || event.button !== 0 || isInteractiveElement(event.target)) {
      return;
    }

    const rect = panelEl.getBoundingClientRect();

    panelDragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height
    };

    panelEl.classList.add("cch-dragging");
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function movePanelDrag(event) {
    if (!panelEl || !panelDragState || event.pointerId !== panelDragState.pointerId) {
      return;
    }

    const left = panelDragState.startLeft + event.clientX - panelDragState.startX;
    const top = panelDragState.startTop + event.clientY - panelDragState.startY;

    panelPosition = clampPanelPosition(left, top, panelDragState.width, panelDragState.height);
    applyPanelPosition();
  }

  function endPanelDrag(event) {
    if (!panelEl || !panelDragState || event.pointerId !== panelDragState.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    panelEl.classList.remove("cch-dragging");
    panelDragState = null;
  }

  function appendPanelResizeHandles(panel) {
    [
      ["top", "cch-resize-top"],
      ["right", "cch-resize-right"],
      ["left", "cch-resize-left"],
      ["top-left", "cch-resize-top-left"],
      ["bottom-right", "cch-resize-bottom-right"]
    ].forEach(([handle, className]) => {
      const handleEl = document.createElement("div");
      handleEl.className = `cch-resize-handle ${className}`;
      handleEl.dataset.resizeHandle = handle;
      handleEl.setAttribute("aria-hidden", "true");
      handleEl.addEventListener("pointerdown", startPanelResize);
      handleEl.addEventListener("pointermove", movePanelResize);
      handleEl.addEventListener("pointerup", endPanelResize);
      handleEl.addEventListener("pointercancel", endPanelResize);
      panel.appendChild(handleEl);
    });
  }

  function startPanelResize(event) {
    if (!panelEl || event.button !== 0) {
      return;
    }

    const rect = panelEl.getBoundingClientRect();
    const handle = event.currentTarget.dataset.resizeHandle || "bottom-right";

    panelPosition = clampPanelPosition(rect.left, rect.top, rect.width, rect.height);
    panelSize = constrainPanelSize({
      width: rect.width,
      height: rect.height
    });
    applyPanelGeometry();

    panelResizeState = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: panelPosition.left,
      startTop: panelPosition.top,
      startWidth: panelSize.width,
      startHeight: panelSize.height,
      startRight: panelPosition.left + panelSize.width,
      startBottom: panelPosition.top + panelSize.height
    };

    panelEl.classList.add("cch-resizing");
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function movePanelResize(event) {
    if (!panelEl || !panelResizeState || event.pointerId !== panelResizeState.pointerId) {
      return;
    }

    const nextGeometry = calculatePanelResize(
      panelResizeState,
      event.clientX - panelResizeState.startX,
      event.clientY - panelResizeState.startY
    );

    panelPosition = {
      left: nextGeometry.left,
      top: nextGeometry.top
    };
    panelSize = {
      width: nextGeometry.width,
      height: nextGeometry.height
    };
    applyPanelGeometry();
  }

  function endPanelResize(event) {
    if (!panelEl || !panelResizeState || event.pointerId !== panelResizeState.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    panelEl.classList.remove("cch-resizing");
    panelResizeState = null;
    savePanelPreferences();
  }

  function calculatePanelResize(state, deltaX, deltaY) {
    const viewportWidth = Math.max(window.innerWidth || 0, PANEL_MIN_WIDTH);
    const viewportHeight = Math.max(window.innerHeight || 0, PANEL_MIN_HEIGHT);
    const minWidth = Math.min(PANEL_MIN_WIDTH, Math.max(1, viewportWidth - PANEL_MARGIN * 2));
    const minHeight = Math.min(PANEL_MIN_HEIGHT, Math.max(1, viewportHeight - PANEL_MARGIN * 2));
    let left = state.startLeft;
    let top = state.startTop;
    let width = state.startWidth;
    let height = state.startHeight;

    if (state.handle.includes("left")) {
      const right = Math.min(state.startRight, viewportWidth - PANEL_MARGIN);
      left = clampNumber(state.startLeft + deltaX, PANEL_MARGIN, right - minWidth);
      width = right - left;
    } else if (state.handle.includes("right")) {
      width = clampNumber(
        state.startWidth + deltaX,
        minWidth,
        viewportWidth - state.startLeft - PANEL_MARGIN
      );
    }

    if (state.handle.includes("top")) {
      const bottom = Math.min(state.startBottom, viewportHeight - PANEL_MARGIN);
      top = clampNumber(state.startTop + deltaY, PANEL_MARGIN, bottom - minHeight);
      height = bottom - top;
    } else if (state.handle.includes("bottom")) {
      height = clampNumber(
        state.startHeight + deltaY,
        minHeight,
        viewportHeight - state.startTop - PANEL_MARGIN
      );
    }

    return { left, top, width, height };
  }

  function applyPanelGeometry() {
    applyPanelSize();
    applyPanelPosition();
  }

  function applyPanelSize() {
    if (!panelEl) {
      return;
    }

    if (!panelSize) {
      panelEl.dataset.resized = "false";
      panelEl.style.width = "";
      panelEl.style.height = "";
      updatePanelCompactWidth();
      return;
    }

    panelSize = constrainPanelSize(panelSize);
    panelEl.dataset.resized = "true";
    panelEl.style.width = `${panelSize.width}px`;
    panelEl.style.height = `${panelSize.height}px`;
    updatePanelCompactWidth();
  }

  function constrainPanelSize(size) {
    const viewportWidth = Math.max(window.innerWidth || 0, PANEL_MIN_WIDTH);
    const viewportHeight = Math.max(window.innerHeight || 0, PANEL_MIN_HEIGHT);
    const maxWidth = Math.max(1, viewportWidth - PANEL_MARGIN * 2);
    const maxHeight = Math.max(1, viewportHeight - PANEL_MARGIN * 2);
    const minWidth = Math.min(PANEL_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(PANEL_MIN_HEIGHT, maxHeight);

    return {
      width: clampNumber(Number(size?.width) || PANEL_MIN_WIDTH, minWidth, maxWidth),
      height: clampNumber(Number(size?.height) || PANEL_MIN_HEIGHT, minHeight, maxHeight)
    };
  }

  function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function applyPanelPosition() {
    if (!panelEl || !panelPosition) {
      return;
    }

    const rect = panelEl.getBoundingClientRect();
    panelPosition = clampPanelPosition(panelPosition.left, panelPosition.top, rect.width, rect.height);
    panelEl.style.left = `${panelPosition.left}px`;
    panelEl.style.top = `${panelPosition.top}px`;
    panelEl.style.right = "auto";
    panelEl.style.bottom = "auto";
  }

  function updatePanelCompactWidth() {
    if (!panelEl) {
      return;
    }

    const width = panelSize?.width || panelEl.getBoundingClientRect().width || PANEL_MIN_WIDTH;
    panelEl.dataset.compactWidth = String(width <= PANEL_COMPACT_WIDTH);
  }

  function clampPanelPosition(left, top, width, height) {
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);

    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop)
    };
  }

  function keepPanelInViewport() {
    if (!panelEl) {
      return;
    }

    applyPanelGeometry();
  }

  function isInteractiveElement(element) {
    return Boolean(
      element.closest(
        'button, input, select, textarea, label, a, [role="button"], [contenteditable="true"]'
      )
    );
  }

  function createRemoteControls() {
    const remoteSection = document.createElement("section");
    remoteSection.className = "cch-section cch-remote-section";
    remoteSectionEl = remoteSection;

    const remoteTitleRow = document.createElement("div");
    remoteTitleRow.className = "cch-section-title-row";

    const remoteTitle = document.createElement("div");
    remoteTitle.className = "cch-section-title";
    remoteTitle.textContent = "Modo remoto";

    const hideRemoteButton = document.createElement("button");
    hideRemoteButton.className = "cch-icon-button";
    hideRemoteButton.type = "button";
    hideRemoteButton.textContent = "Ocultar";
    hideRemoteButton.setAttribute("aria-label", "Ocultar modo remoto");
    hideRemoteButton.addEventListener("click", hideRemoteControls);

    remoteTitleRow.append(remoteTitle, hideRemoteButton);

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

    remoteSection.append(remoteTitleRow, remoteRow, remoteUrlEl, remoteStatusEl);

    return remoteSection;
  }

  function hideRemoteControls() {
    remoteControlsHidden = true;
    remoteSectionEl?.remove();
    remoteSectionEl = null;
    remoteToggleButton = null;
    remoteStatusEl = null;
    remoteUrlEl = null;
    savePanelPreferences();
    updateRemoteRevealButton();
    updateRemoteUi();
    setStatus(
      remoteEnabled ? "Opcion de modo remoto oculta. Sigue activa." : "Opcion de modo remoto oculta.",
      "neutral"
    );
  }

  function showRemoteControls() {
    remoteControlsHidden = false;
    savePanelPreferences();

    if (panelEl && !remoteSectionEl) {
      const footer = panelEl.querySelector(".cch-footer");
      const remoteSection = createRemoteControls();
      panelEl.insertBefore(remoteSection, footer);
      updateRemoteUi();
    }

    updateRemoteRevealButton();
    setStatus("Opcion de modo remoto visible.", "neutral");
  }

  function updateRemoteRevealButton() {
    if (!panelEl) {
      return;
    }

    const headerActions = panelEl.querySelector(".cch-header-actions");

    if (!headerActions) {
      return;
    }

    if (!remoteControlsHidden) {
      remoteRevealButton?.remove();
      remoteRevealButton = null;
      return;
    }

    if (remoteRevealButton) {
      return;
    }

    remoteRevealButton = document.createElement("button");
    remoteRevealButton.className = "cch-icon-button";
    remoteRevealButton.type = "button";
    remoteRevealButton.textContent = "Remoto";
    remoteRevealButton.setAttribute("aria-label", "Mostrar modo remoto");
    remoteRevealButton.addEventListener("click", showRemoteControls);
    headerActions.insertBefore(remoteRevealButton, headerActions.lastElementChild);
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
    const key = currentStorageKey || getStorageKey();
    const legacyKey = getLegacyStorageKey();
    const keysToLoad = legacyKey === key ? [key] : [key, legacyKey];

    return new Promise((resolve) => {
      if (!hasChromeStorage()) {
        resolve(defaultSections());
        return;
      }

      chrome.storage.local.get(keysToLoad, (result) => {
        if (chrome.runtime.lastError) {
          resolve(defaultSections());
          return;
        }

        const stored = result[key];

        if (stored === undefined) {
          const legacyStored = legacyKey === key ? undefined : result[legacyKey];

          if (legacyStored !== undefined) {
            const normalizedLegacy = normalizeStoredRubric(legacyStored);

            if (normalizedLegacy.length > 0 && !looksLikeLegacyDefaultRubric(normalizedLegacy)) {
              persistRubricPayload(key, buildRubricPayload(normalizedLegacy)).catch(() => {});
              resolve(normalizedLegacy);
              return;
            }
          }

          const defaults = defaultSections();
          persistRubricPayload(key, buildRubricPayload(defaults)).catch(() => {});
          resolve(defaults);
          return;
        }

        resolve(normalizeStoredRubric(stored));
      });
    });
  }

  function saveRubric() {
    const key = currentStorageKey || getStorageKey();
    return persistRubricPayload(key, buildRubricPayload(sections));
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

    if (isEditMode && editingSectionId === section.id) {
      renderEditingSectionHeader(header, section);
      sectionBlock.appendChild(header);
      return;
    }

    if (!isEditMode && section.criteria.length > 0) {
      const selectionState = getSectionSelectionState(section);

      header.setAttribute("role", "checkbox");
      header.setAttribute("tabindex", "0");
      header.setAttribute("aria-checked", selectionState);
      header.setAttribute("aria-label", `Alternar toda la seccion ${section.name}`);
      header.addEventListener("click", (event) => {
        if (isInteractiveElement(event.target)) {
          return;
        }

        toggleSectionCriteria(section.id);
      });
      header.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        toggleSectionCriteria(section.id);
      });
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
    actions.className = "cch-section-actions cch-edit-only";

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

        if (isEditMode && editingCriterionId === criterion.id) {
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
    row.classList.toggle("cch-criterion-checked", Boolean(criterion.checked));
    row.setAttribute("role", "checkbox");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-checked", String(Boolean(criterion.checked)));
    row.setAttribute("aria-label", `${criterion.name}, ${formatNumber(criterion.points)} puntos`);
    row.addEventListener("click", (event) => {
      if (isEditMode || isInteractiveElement(event.target)) {
        return;
      }

      setCriterionChecked(row, section, criterion, !criterion.checked);
    });
    row.addEventListener("keydown", (event) => {
      if (isEditMode || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }

      event.preventDefault();
      setCriterionChecked(row, section, criterion, !criterion.checked);
    });

    const checkbox = document.createElement("input");
    checkbox.className = "cch-checkbox";
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(criterion.checked);
    checkbox.setAttribute("aria-label", `Marcar ${criterion.name}`);
    checkbox.addEventListener("change", () => {
      setCriterionChecked(row, section, criterion, checkbox.checked);
    });

    const name = document.createElement("span");
    name.className = "cch-criterion-name";
    name.textContent = criterion.name;

    const points = document.createElement("span");
    points.className = "cch-criterion-points";
    points.textContent = formatNumber(criterion.points);

    const editButton = document.createElement("button");
    editButton.className = "cch-icon-button cch-edit-only";
    editButton.type = "button";
    editButton.textContent = "Editar";
    editButton.addEventListener("click", () => {
      editingSectionId = null;
      editingCriterionId = criterion.id;
      renderCriteria();
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "cch-icon-button cch-danger cch-edit-only";
    deleteButton.type = "button";
    deleteButton.textContent = "Eliminar";
    deleteButton.addEventListener("click", () => deleteCriterion(section.id, criterion.id));

    row.append(checkbox, name, points, editButton, deleteButton);
  }

  function getSectionSelectionState(section) {
    if (section.criteria.length === 0) {
      return "false";
    }

    const checkedCount = section.criteria.filter((criterion) => criterion.checked).length;

    if (checkedCount === 0) {
      return "false";
    }

    return checkedCount === section.criteria.length ? "true" : "mixed";
  }

  function setCriterionChecked(row, section, criterion, checked) {
    criterion.checked = Boolean(checked);

    const checkbox = row.querySelector(".cch-checkbox");
    if (checkbox) {
      checkbox.checked = criterion.checked;
    }

    row.classList.toggle("cch-criterion-checked", criterion.checked);
    row.setAttribute("aria-checked", String(criterion.checked));
    updateSectionHeaderSelectionState(row, section);
    calculateTotal();
    broadcastRemoteState();
  }

  function updateSectionHeaderSelectionState(row, section) {
    const sectionBlock = row.closest(".cch-section-block");
    const header = sectionBlock?.querySelector('.cch-section-header[role="checkbox"]');

    if (header) {
      header.setAttribute("aria-checked", getSectionSelectionState(section));
    }
  }

  function toggleSectionCriteria(sectionId) {
    const section = sections.find((item) => item.id === sectionId);

    if (!section) {
      setStatus("No se encontro la seccion.", "error");
      return;
    }

    const shouldCheck = section.criteria.some((criterion) => !criterion.checked);
    setSectionCriteriaChecked(section, shouldCheck, { source: "local" });
  }

  function setSectionCriteriaChecked(section, checked, options = {}) {
    if (!section.criteria.length) {
      setStatus("La seccion no tiene criterios.", "neutral");
      return;
    }

    const nextChecked = Boolean(checked);
    section.criteria.forEach((criterion) => {
      criterion.checked = nextChecked;
    });

    renderCriteria();
    broadcastRemoteState();

    const statusMessage = nextChecked ? "Seccion marcada completa." : "Seccion desmarcada.";
    setStatus(
      options.source === "remote" ? `${statusMessage} Desde el panel remoto.` : statusMessage,
      "success"
    );
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
    form.className = "cch-add-criterion-form cch-edit-only";

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

    if (message.type === "remote:toggleSection") {
      applyRemoteSectionToggle(message.sectionId, message.checked);
      return;
    }

    if (message.type === "remote:addSection") {
      applyRemoteAddSection(message.name);
      return;
    }

    if (message.type === "remote:updateSection") {
      applyRemoteUpdateSection(message.sectionId, message.name);
      return;
    }

    if (message.type === "remote:deleteSection") {
      applyRemoteDeleteSection(message.sectionId);
      return;
    }

    if (message.type === "remote:addCriterion") {
      applyRemoteAddCriterion(message.sectionId, message.name, message.points);
      return;
    }

    if (message.type === "remote:updateCriterion") {
      applyRemoteUpdateCriterion(
        message.sectionId,
        message.criterionId,
        message.name,
        message.points
      );
      return;
    }

    if (message.type === "remote:deleteCriterion") {
      applyRemoteDeleteCriterion(message.sectionId, message.criterionId);
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

  function applyRemoteSectionToggle(sectionId, checked) {
    const section = sections.find((item) => item.id === sectionId);

    if (!section) {
      setStatus("El panel remoto intento marcar una seccion que ya no existe.", "error");
      broadcastRemoteState();
      return;
    }

    setSectionCriteriaChecked(section, checked, { source: "remote" });
  }

  function applyRemoteAddSection(nameValue) {
    const name = String(nameValue || "").trim();

    if (!name) {
      setStatus("El panel web envio una seccion sin nombre.", "error");
      broadcastRemoteState();
      return;
    }

    sections.push({
      id: makeId(),
      name,
      criteria: []
    });

    editingSectionId = null;
    editingCriterionId = null;
    renderCriteria();
    broadcastRemoteState();

    saveRubric()
      .then(() => setStatus("Seccion agregada desde el panel web.", "success"))
      .catch(() => setStatus("No se pudo guardar la seccion del panel web.", "error"));
  }

  function applyRemoteUpdateSection(sectionId, nameValue) {
    const section = sections.find((item) => item.id === sectionId);
    const name = String(nameValue || "").trim();

    if (!section) {
      setStatus("El panel web intento editar una seccion que ya no existe.", "error");
      broadcastRemoteState();
      return;
    }

    if (!name) {
      setStatus("El nombre de la seccion no puede estar vacio.", "error");
      broadcastRemoteState();
      return;
    }

    section.name = name;
    editingSectionId = null;
    renderCriteria();
    broadcastRemoteState();

    saveRubric()
      .then(() => setStatus("Seccion actualizada desde el panel web.", "success"))
      .catch(() => setStatus("No se pudo guardar el cambio del panel web.", "error"));
  }

  function applyRemoteDeleteSection(sectionId) {
    const section = sections.find((item) => item.id === sectionId);

    if (!section) {
      setStatus("El panel web intento eliminar una seccion que ya no existe.", "error");
      broadcastRemoteState();
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
      .then(() => setStatus("Seccion eliminada desde el panel web.", "success"))
      .catch(() => setStatus("No se pudo guardar la eliminacion del panel web.", "error"));
  }

  function applyRemoteAddCriterion(sectionId, nameValue, pointsValue) {
    const section = sections.find((item) => item.id === sectionId);
    const name = String(nameValue || "").trim();
    const points = parsePoints(pointsValue);

    if (!section) {
      setStatus("El panel web intento agregar a una seccion que ya no existe.", "error");
      broadcastRemoteState();
      return;
    }

    if (!name) {
      setStatus("El panel web envio un criterio sin nombre.", "error");
      broadcastRemoteState();
      return;
    }

    if (points === null) {
      setStatus("El puntaje enviado desde el panel web no es valido.", "error");
      broadcastRemoteState();
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
      .then(() => setStatus("Criterio agregado desde el panel web.", "success"))
      .catch(() => setStatus("No se pudo guardar el criterio del panel web.", "error"));
  }

  function applyRemoteUpdateCriterion(sectionId, criterionId, nameValue, pointsValue) {
    const section = sections.find((item) => item.id === sectionId);
    const criterion = section?.criteria.find((item) => item.id === criterionId);
    const name = String(nameValue || "").trim();
    const points = parsePoints(pointsValue);

    if (!section || !criterion) {
      setStatus("El panel web intento editar un criterio que ya no existe.", "error");
      broadcastRemoteState();
      return;
    }

    if (!name) {
      setStatus("El nombre del criterio no puede estar vacio.", "error");
      broadcastRemoteState();
      return;
    }

    if (points === null) {
      setStatus("El puntaje del criterio no es valido.", "error");
      broadcastRemoteState();
      return;
    }

    criterion.name = name;
    criterion.points = points;
    editingCriterionId = null;
    renderCriteria();
    broadcastRemoteState();

    saveRubric()
      .then(() => setStatus("Criterio actualizado desde el panel web.", "success"))
      .catch(() => setStatus("No se pudo guardar el cambio del panel web.", "error"));
  }

  function applyRemoteDeleteCriterion(sectionId, criterionId) {
    const section = sections.find((item) => item.id === sectionId);

    if (!section) {
      setStatus("El panel web intento eliminar un criterio que ya no existe.", "error");
      broadcastRemoteState();
      return;
    }

    section.criteria = section.criteria.filter((criterion) => criterion.id !== criterionId);

    if (editingCriterionId === criterionId) {
      editingCriterionId = null;
    }

    renderCriteria();
    broadcastRemoteState();

    saveRubric()
      .then(() => setStatus("Criterio eliminado desde el panel web.", "success"))
      .catch(() => setStatus("No se pudo guardar la eliminacion del panel web.", "error"));
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

    if (remoteRevealButton) {
      remoteRevealButton.textContent = remoteEnabled ? "Remoto activo" : "Remoto";
      remoteRevealButton.classList.toggle("cch-button-primary", remoteEnabled);
      remoteRevealButton.setAttribute(
        "aria-label",
        remoteEnabled ? "Mostrar modo remoto activo" : "Mostrar modo remoto"
      );
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

  function findGradeInput() {
    const scoredCandidates = Array.from(document.querySelectorAll("input"))
      .filter(isUsableGradeInput)
      .filter((input) => !isRubricCriterionInput(input))
      .map((input) => scoreGradeInput(input))
      .sort((a, b) => b.score - a.score);

    if (scoredCandidates.length === 0) {
      return null;
    }

    const overallGradeMatch = scoredCandidates.find((candidate) => candidate.isOverallGradeInput);

    if (overallGradeMatch) {
      return overallGradeMatch.input;
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

  async function insertGradeIntoCanvas() {
    const sectionResult = await insertSectionScoresIntoCanvas();

    if (sectionResult.expected === 0) {
      setStatus("No hay secciones con criterios para ingresar en la rubrica.", "error");
      return false;
    }

    if (sectionResult.found === 0) {
      setStatus("No se encontraron campos visibles de puntaje de rubrica en SpeedGrader.", "error");
      return false;
    }

    if (sectionResult.written > 0) {
      await triggerNeutralRubricCommitClick();
    }

    if (sectionResult.written < sectionResult.expected) {
      setStatus(
        `Subtotales ingresados ${sectionResult.written}/${sectionResult.expected}. Revisa la rubrica antes de entregar.`,
        "error"
      );
      return false;
    }

    setStatus(
      `Subtotales ingresados en la rubrica (${sectionResult.written}/${sectionResult.expected}).`,
      "success"
    );

    return true;
  }

  async function insertAndSubmitEvaluation() {
    if (!(await insertGradeIntoCanvas())) {
      return false;
    }

    setStatus("Subtotales ingresados. Intentando entregar la evaluacion...", "neutral");
    await wait(RUBRIC_BEFORE_SUBMIT_DELAY_MS);
    scheduleEvaluationSubmitAttempt(0);
    return true;
  }

  async function insertSectionScoresIntoCanvas() {
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

      focusWithoutScrolling(input);
      setNativeValue(input, value);
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      await wait(RUBRIC_INPUT_WRITE_DELAY_MS);
    }

    return {
      expected: sectionScores.length,
      found: rubricInputs.length,
      written: count
    };
  }

  async function triggerNeutralRubricCommitClick() {
    const neutralButton = document.createElement("button");
    neutralButton.type = "button";
    neutralButton.tabIndex = -1;
    neutralButton.setAttribute("aria-hidden", "true");
    neutralButton.style.position = "fixed";
    neutralButton.style.top = "0";
    neutralButton.style.left = "0";
    neutralButton.style.width = "1px";
    neutralButton.style.height = "1px";
    neutralButton.style.padding = "0";
    neutralButton.style.margin = "0";
    neutralButton.style.opacity = "0";
    neutralButton.style.border = "0";
    neutralButton.style.pointerEvents = "none";

    document.body.appendChild(neutralButton);
    focusWithoutScrolling(neutralButton);
    neutralButton.click();
    await wait(RUBRIC_COMMIT_CLICK_DELAY_MS);
    neutralButton.remove();
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

  function scheduleEvaluationSubmitAttempt(attempt) {
    window.setTimeout(() => {
      const submitButton = findSubmitEvaluationButton();

      if (submitButton) {
        focusWithoutScrolling(submitButton);
        submitButton.click();
        setStatus("Subtotales ingresados y boton Entregar evaluacion presionado.", "success");
        return;
      }

      if (attempt + 1 >= SUBMIT_EVALUATION_MAX_ATTEMPTS) {
        setStatus(
          "Subtotales ingresados, pero no se encontro un boton disponible para Entregar evaluacion.",
          "error"
        );
        return;
      }

      scheduleEvaluationSubmitAttempt(attempt + 1);
    }, SUBMIT_EVALUATION_RETRY_DELAY_MS);
  }

  function findSubmitEvaluationButton() {
    return Array.from(
      document.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button']")
    )
      .filter(isUsableSubmitEvaluationButton)
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
        score: scoreSubmitEvaluationButton(element)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        const topDiff = b.rect.top - a.rect.top;

        if (Math.abs(topDiff) > 8) {
          return topDiff;
        }

        return b.rect.left - a.rect.left;
      })
      .map((candidate) => candidate.element)[0] || null;
  }

  function isUsableSubmitEvaluationButton(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (!isVisible(element)) {
      return false;
    }

    if (element.closest(`#${PANEL_ID}`) || element.id === LAUNCHER_ID) {
      return false;
    }

    if (element.matches("[disabled]") || element.getAttribute("aria-disabled") === "true") {
      return false;
    }

    return Boolean(getActionElementText(element));
  }

  function scoreSubmitEvaluationButton(element) {
    const text = getActionElementText(element);
    const rect = element.getBoundingClientRect();
    let score = 0;

    if (text.includes("entregar evaluacion")) score += 180;
    if (text.includes("entregar") && text.includes("evaluacion")) score += 120;
    if (text.includes("submit assessment")) score += 180;
    if (text.includes("submit evaluation")) score += 180;
    if (text.includes("submit") && (text.includes("assessment") || text.includes("evaluation"))) {
      score += 120;
    }
    if (text.includes("cancelar") || text.includes("cancel")) score -= 180;
    if (text.includes("completa") || text.includes("complete")) score -= 80;
    if (text.includes("rubrica") || text.includes("rubric")) score -= 40;
    if (rect.top > window.innerHeight * 0.45) score += 18;
    if (rect.left > window.innerWidth * 0.5) score += 14;

    return score;
  }

  function getActionElementText(element) {
    const value =
      element instanceof HTMLInputElement || element instanceof HTMLButtonElement ? element.value : "";

    return normalizeText(
      [
        element.innerText,
        element.textContent,
        value,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.id,
        element.className
      ].join(" ")
    );
  }

  function wait(delayMs) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
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

  function focusWithoutScrolling(element) {
    if (!element || typeof element.focus !== "function") {
      return;
    }

    try {
      element.focus({ preventScroll: true });
    } catch (_error) {
      element.focus();
    }
  }

  function getStorageKey() {
    return UNIVERSAL_RUBRIC_STORAGE_KEY;
  }

  function getLegacyStorageKey() {
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
    const directText = getDirectInputContextText(input);
    const text = getRubricCriterionCandidateText(input);
    const cellText = getRubricCriterionCellText(input);
    const hasExplicitCriterionScore =
      text.includes("puntaje de criterio") ||
      text.includes("criterion score") ||
      cellText.includes("puntaje de criterio") ||
      cellText.includes("criterion score");
    const hasCriterionScoreText =
      hasExplicitCriterionScore ||
      directText.includes("criterio") ||
      directText.includes("criterion");
    const hasRubricPointsAttribute =
      directText.includes("rubric") && (directText.includes("points") || directText.includes("puntos"));
    const hasPointsLimit =
      /\/\s*\d+([.,]\d+)?\s*(puntos|pts|points)?/.test(text) ||
      text.includes("agregar comentario") ||
      directText.includes("[points]");
    const hasRubricContext =
      hasRubricAncestor(input) || text.includes("rubric") || text.includes("rubrica");

    if (hasOverallGradeContext(input) || !hasPointsLimit) {
      return false;
    }

    if (hasExplicitCriterionScore) {
      return true;
    }

    if (!hasRubricContext) {
      return false;
    }

    return hasCriterionScoreText || hasRubricPointsAttribute;
  }

  function scoreRubricCriterionInput(input) {
    const directText = getDirectInputContextText(input);
    const text = getRubricCriterionCandidateText(input);
    let score = 0;

    if (text.includes("puntaje de criterio")) score += 80;
    if (text.includes("criterion score")) score += 80;
    if (directText.includes("criterio") || directText.includes("criterion")) score += 35;
    if (directText.includes("rubric") && directText.includes("points")) score += 35;
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
    const isOverallGradeInput = hasOverallGradeContext(input);
    let score = 0;

    if (isOverallGradeInput) score += 160;
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
      isRightSide,
      isOverallGradeInput
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

  function getDirectInputContextText(input) {
    const parts = [
      input.getAttribute("aria-label"),
      input.getAttribute("name"),
      input.id,
      input.placeholder,
      input.title,
      input.className
    ];

    if (input.labels) {
      Array.from(input.labels).forEach((label) => parts.push(label.innerText));
    }

    const closestLabel = input.closest("label");
    if (closestLabel) {
      parts.push(closestLabel.innerText);
    }

    return normalizeText(parts.join(" "));
  }

  function getRubricCriterionCandidateText(input) {
    const parts = [getInputContextText(input)];
    const cell = input.closest("td, th, [role='cell'], [role='gridcell']");
    const row = input.closest("tr, [role='row']");
    const rubricContainer = findRubricContainer(input);

    if (cell) {
      parts.push(cell.innerText);
    }

    if (row) {
      parts.push(row.innerText);
    }

    if (rubricContainer) {
      parts.push(
        rubricContainer.id,
        rubricContainer.className,
        rubricContainer.getAttribute("role"),
        rubricContainer.getAttribute("aria-label")
      );
    }

    return normalizeText(parts.join(" ").slice(0, 4000));
  }

  function getRubricCriterionCellText(input) {
    const cell = input.closest("td, th, [role='cell'], [role='gridcell']");
    return normalizeText(cell ? cell.innerText : "");
  }

  function hasOverallGradeContext(input) {
    const text = getDirectInputContextText(input);

    return (
      text.includes("calificacion de") ||
      text.includes("calificacion total") ||
      text.includes("puntaje del instructor") ||
      text.includes("final grade") ||
      text.includes("total grade")
    );
  }

  function hasRubricAncestor(input) {
    return Boolean(findRubricContainer(input));
  }

  function findRubricContainer(input) {
    let node = input.parentElement;
    let depth = 0;

    while (node && depth < 14) {
      const text = normalizeText(
        [node.id, node.className, node.getAttribute("role"), node.getAttribute("aria-label")].join(
          " "
        )
      );

      if (text.includes("rubric") || text.includes("rubrica") || text.includes("criterio")) {
        return node;
      }

      node = node.parentElement;
      depth += 1;
    }

    return null;
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
    editModeCheckbox = null;
    panelDragState = null;
    panelResizeState = null;
    remoteSectionEl = null;
    remoteRevealButton = null;
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
    window.addEventListener("resize", keepPanelInViewport);
  }

  start();
})();
