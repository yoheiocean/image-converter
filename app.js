const ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const ACCEPTED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

const state = {
  items: [],
  jobId: 0,
  nextId: 1,
  lightbox: {
    isOpen: false,
    itemId: null,
    variant: "original",
    width: 0,
    height: 0,
    sourceLabel: "Original",
  },
};

const els = {
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),
  cards: document.getElementById("cards"),
  cardTemplate: document.getElementById("cardTemplate"),
  formatSelect: document.getElementById("formatSelect"),
  qualityInput: document.getElementById("qualityInput"),
  qualityValue: document.getElementById("qualityValue"),
  resizeMode: document.getElementById("resizeMode"),
  percentInput: document.getElementById("percentInput"),
  widthInput: document.getElementById("widthInput"),
  heightInput: document.getElementById("heightInput"),
  keepAspectInput: document.getElementById("keepAspectInput"),
  percentWrap: document.getElementById("percentWrap"),
  widthWrap: document.getElementById("widthWrap"),
  heightWrap: document.getElementById("heightWrap"),
  downloadAllBtn: document.getElementById("downloadAllBtn"),
  summary: document.getElementById("summary"),
  lightbox: document.getElementById("lightbox"),
  lightboxClose: document.getElementById("lightboxClose"),
  lightboxStage: document.querySelector(".lightbox-stage"),
  lightboxImage: document.getElementById("lightboxImage"),
  lightboxMeta: document.getElementById("lightboxMeta"),
};

function bytesToHuman(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "Unknown";
  }
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let idx = 0;
  while (n >= 1024 && idx < units.length - 1) {
    n /= 1024;
    idx += 1;
  }
  const rounded = idx === 0 ? Math.round(n).toString() : n.toFixed(2);
  return `${rounded} ${units[idx]}`;
}

function getFileExtension(filename) {
  const idx = filename.lastIndexOf(".");
  if (idx < 0 || idx === filename.length - 1) {
    return "";
  }
  return filename.slice(idx + 1).toLowerCase();
}

function isHeicFile(file) {
  const ext = getFileExtension(file.name);
  const mime = (file.type || "").toLowerCase();
  return HEIC_EXTENSIONS.has(ext) || mime.includes("heic") || mime.includes("heif");
}

function isSupportedFile(file) {
  const ext = getFileExtension(file.name);
  return ACCEPTED_MIME_TYPES.has(file.type) || ACCEPTED_EXTENSIONS.has(ext);
}

function getMimeAndExtension(format) {
  if (format === "png") {
    return { mime: "image/png", ext: "png" };
  }
  if (format === "webp") {
    return { mime: "image/webp", ext: "webp" };
  }
  return { mime: "image/jpeg", ext: "jpg" };
}

function parsePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getSettings() {
  return {
    format: els.formatSelect.value,
    qualityPercent: Number(els.qualityInput.value),
    resizeMode: els.resizeMode.value,
    scalePercent: parsePositiveInt(els.percentInput.value) ?? 100,
    width: parsePositiveInt(els.widthInput.value),
    height: parsePositiveInt(els.heightInput.value),
    keepAspect: els.keepAspectInput.checked,
  };
}

function getOutputDimensions(originalWidth, originalHeight, settings) {
  const ow = originalWidth;
  const oh = originalHeight;
  let w = ow;
  let h = oh;

  if (settings.resizeMode === "percent") {
    const scale = Math.max(1, settings.scalePercent) / 100;
    w = Math.max(1, Math.round(ow * scale));
    h = Math.max(1, Math.round(oh * scale));
  } else if (settings.resizeMode === "exact") {
    const targetW = settings.width;
    const targetH = settings.height;

    if (settings.keepAspect) {
      if (targetW && targetH) {
        const ratio = Math.min(targetW / ow, targetH / oh);
        w = Math.max(1, Math.round(ow * ratio));
        h = Math.max(1, Math.round(oh * ratio));
      } else if (targetW) {
        w = targetW;
        h = Math.max(1, Math.round((targetW * oh) / ow));
      } else if (targetH) {
        h = targetH;
        w = Math.max(1, Math.round((targetH * ow) / oh));
      }
    } else {
      w = targetW || ow;
      h = targetH || oh;
    }
  }

  return { width: w, height: h };
}

async function loadImageFromBlob(blob, sourceName) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  img.src = url;

  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Could not load ${sourceName}`));
  });

  return {
    url,
    width: img.naturalWidth,
    height: img.naturalHeight,
    image: img,
  };
}

function loadImageFromFile(file) {
  return loadImageFromBlob(file, file.name);
}

async function decodeHeicBlob(file) {
  const decoder = window.heic2any;
  if (typeof decoder !== "function") {
    throw new Error("HEIC decoder failed to load. Check network access and retry.");
  }
  const output = await decoder({
    blob: file,
    toType: "image/png",
  });
  const decoded = Array.isArray(output) ? output[0] : output;
  if (!(decoded instanceof Blob)) {
    throw new Error("HEIC decode did not return a valid image.");
  }
  return decoded;
}

async function loadSourceImage(file) {
  if (!isHeicFile(file)) {
    return loadImageFromFile(file);
  }
  const decodedBlob = await decodeHeicBlob(file);
  return loadImageFromBlob(decodedBlob, file.name);
}

function blobFromCanvas(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Image conversion failed"));
          return;
        }
        resolve(blob);
      },
      mime,
      quality
    );
  });
}

async function convertItem(item, settings) {
  const { mime } = getMimeAndExtension(settings.format);
  const { width, height } = getOutputDimensions(item.original.width, item.original.height, settings);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.drawImage(item.original.image, 0, 0, width, height);

  const qualityValue = mime === "image/png" ? undefined : settings.qualityPercent / 100;
  const blob = await blobFromCanvas(canvas, mime, qualityValue);
  const previewUrl = URL.createObjectURL(blob);

  return { blob, previewUrl, width, height };
}

function setResizeVisibility() {
  const mode = els.resizeMode.value;
  els.percentWrap.style.display = mode === "percent" ? "flex" : "none";
  const exact = mode === "exact";
  els.widthWrap.style.display = exact ? "flex" : "none";
  els.heightWrap.style.display = exact ? "flex" : "none";
  els.keepAspectInput.disabled = !exact;
}

function updateQualityAvailability() {
  const isPng = els.formatSelect.value === "png";
  els.qualityInput.disabled = isPng;
  els.qualityValue.textContent = isPng ? "N/A for PNG" : els.qualityInput.value;
}

function updateSummary() {
  if (state.items.length === 0) {
    els.summary.textContent = "No images loaded.";
    return;
  }

  let convertedReady = 0;
  let totalOriginal = 0;
  let totalConverted = 0;

  for (const item of state.items) {
    totalOriginal += item.file.size;
    if (item.converted?.blob) {
      convertedReady += 1;
      totalConverted += item.converted.blob.size;
    }
  }

  const left = `${state.items.length} image(s) loaded. Original total: ${bytesToHuman(totalOriginal)}.`;
  if (convertedReady === state.items.length) {
    els.summary.textContent = `${left} Converted estimate total: ${bytesToHuman(totalConverted)}.`;
  } else {
    els.summary.textContent = `${left} Preparing previews...`;
  }
}

function updateDownloadAllState() {
  const ready = state.items.length > 0 && state.items.every((item) => item.converted?.blob);
  els.downloadAllBtn.disabled = !ready;
}

function getCardForItemId(itemId) {
  return els.cards.querySelector(`[data-item-id="${itemId}"]`);
}

function getItemById(itemId) {
  return state.items.find((item) => item.id === itemId) || null;
}

function getLightboxSource(item, variant) {
  if (variant === "converted" && item.converted?.previewUrl) {
    return {
      src: item.converted.previewUrl,
      width: item.converted.width,
      height: item.converted.height,
      label: "Converted",
    };
  }
  if (variant === "converted" && !item.converted?.previewUrl) {
    return {
      src: item.original.url,
      width: item.original.width,
      height: item.original.height,
      label: "Original (converted not ready yet)",
    };
  }
  return {
    src: item.original.url,
    width: item.original.width,
    height: item.original.height,
    label: "Original",
  };
}

function updateLightboxSizing() {
  if (!state.lightbox.isOpen) {
    return;
  }

  const w = state.lightbox.width;
  const h = state.lightbox.height;
  if (!w || !h) {
    return;
  }

  const stageStyle = window.getComputedStyle(els.lightboxStage);
  const padX = Number.parseFloat(stageStyle.paddingLeft || "0") + Number.parseFloat(stageStyle.paddingRight || "0");
  const padY = Number.parseFloat(stageStyle.paddingTop || "0") + Number.parseFloat(stageStyle.paddingBottom || "0");
  const maxW = Math.max(1, Math.floor(els.lightboxStage.clientWidth - padX - 2));
  const maxH = Math.max(1, Math.floor(els.lightboxStage.clientHeight - padY - 2));
  const scale = Math.min(1, maxW / w, maxH / h);
  const displayW = Math.max(1, Math.round(w * scale));
  const displayH = Math.max(1, Math.round(h * scale));
  const scalePercent = Math.round(scale * 100);

  els.lightboxImage.style.width = `${displayW}px`;
  els.lightboxImage.style.height = `${displayH}px`;
  const scaleText = scalePercent === 100 ? "100% (actual size)" : `${scalePercent}% (fit to browser)`;
  els.lightboxMeta.textContent =
    `${state.lightbox.sourceLabel}: ${w}x${h}px | shown ${displayW}x${displayH}px | scale ${scaleText}`;
}

function openLightbox(itemId, variant) {
  const item = getItemById(itemId);
  if (!item) {
    return;
  }

  const source = getLightboxSource(item, variant);
  state.lightbox.isOpen = true;
  state.lightbox.itemId = itemId;
  state.lightbox.variant = variant;
  state.lightbox.width = source.width;
  state.lightbox.height = source.height;
  state.lightbox.sourceLabel = source.label;
  els.lightboxImage.src = source.src;
  els.lightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => requestAnimationFrame(updateLightboxSizing));
}

function closeLightbox() {
  state.lightbox.isOpen = false;
  state.lightbox.itemId = null;
  state.lightbox.width = 0;
  state.lightbox.height = 0;
  state.lightbox.sourceLabel = "Original";
  els.lightbox.classList.add("hidden");
  els.lightboxImage.removeAttribute("src");
  els.lightboxMeta.textContent = "";
  document.body.style.overflow = "";
}

function renderOneCard(item) {
  const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.itemId = String(item.id);

  node.querySelector(".file-name").textContent = item.file.name;
  const originalPreview = node.querySelector(".original-preview");
  const convertedPreview = node.querySelector(".converted-preview");
  originalPreview.src = item.original.url;
  convertedPreview.src = item.original.url;
  node.querySelector(".original-meta").textContent =
    `${item.original.width}x${item.original.height}px | ${bytesToHuman(item.file.size)}`;

  node.querySelector(".remove-btn").addEventListener("click", () => {
    removeItem(item.id);
  });

  node.querySelector(".download-btn").addEventListener("click", () => {
    if (item.converted?.blob) {
      downloadConvertedItem(item);
    }
  });

  originalPreview.addEventListener("click", () => {
    openLightbox(item.id, "original");
  });

  convertedPreview.addEventListener("click", () => {
    openLightbox(item.id, "converted");
  });

  els.cards.appendChild(node);
}

function updateConvertedCard(item, errorMessage) {
  const card = getCardForItemId(item.id);
  if (!card) {
    return;
  }
  const convertedPreview = card.querySelector(".converted-preview");
  const convertedMeta = card.querySelector(".converted-meta");
  const downloadBtn = card.querySelector(".download-btn");

  if (errorMessage) {
    convertedMeta.textContent = `Conversion failed: ${errorMessage}`;
    downloadBtn.disabled = true;
    return;
  }

  convertedPreview.src = item.converted.previewUrl;
  convertedMeta.textContent =
    `${item.converted.width}x${item.converted.height}px | estimated ${bytesToHuman(item.converted.blob.size)}`;
  downloadBtn.disabled = false;

  if (state.lightbox.isOpen && state.lightbox.itemId === item.id && state.lightbox.variant === "converted") {
    state.lightbox.width = item.converted.width;
    state.lightbox.height = item.converted.height;
    state.lightbox.sourceLabel = "Converted";
    els.lightboxImage.src = item.converted.previewUrl;
    requestAnimationFrame(updateLightboxSizing);
  }
}

function revokeConvertedUrl(item) {
  if (item.converted?.previewUrl) {
    URL.revokeObjectURL(item.converted.previewUrl);
  }
}

function cleanupItem(item) {
  revokeConvertedUrl(item);
  URL.revokeObjectURL(item.original.url);
}

function removeItem(itemId) {
  const index = state.items.findIndex((i) => i.id === itemId);
  if (index < 0) {
    return;
  }
  if (state.lightbox.isOpen && state.lightbox.itemId === itemId) {
    closeLightbox();
  }
  const [item] = state.items.splice(index, 1);
  cleanupItem(item);
  const card = getCardForItemId(itemId);
  if (card) {
    card.remove();
  }
  updateDownloadAllState();
  updateSummary();
}

function setConvertingState(converting) {
  for (const card of els.cards.children) {
    const downloadBtn = card.querySelector(".download-btn");
    if (downloadBtn) {
      downloadBtn.disabled = converting;
    }
    const meta = card.querySelector(".converted-meta");
    if (meta && converting) {
      meta.textContent = "Converting preview...";
    }
  }
}

async function refreshAllPreviews() {
  if (state.items.length === 0) {
    updateDownloadAllState();
    updateSummary();
    return;
  }

  const settings = getSettings();
  const activeJobId = ++state.jobId;
  setConvertingState(true);
  updateSummary();
  updateDownloadAllState();

  for (const item of state.items) {
    if (activeJobId !== state.jobId) {
      return;
    }
    try {
      const converted = await convertItem(item, settings);
      if (activeJobId !== state.jobId) {
        URL.revokeObjectURL(converted.previewUrl);
        return;
      }
      revokeConvertedUrl(item);
      item.converted = converted;
      updateConvertedCard(item);
    } catch (error) {
      item.converted = null;
      updateConvertedCard(item, error instanceof Error ? error.message : "Unknown error");
    }
  }

  if (activeJobId === state.jobId) {
    updateDownloadAllState();
    updateSummary();
  }
}

function debounce(fn, delayMs) {
  let timer = null;
  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      fn();
    }, delayMs);
  };
}

const debouncedRefresh = debounce(refreshAllPreviews, 220);

async function handleNewFiles(fileList) {
  const files = Array.from(fileList ?? []).filter((f) => isSupportedFile(f));
  if (files.length === 0) {
    els.summary.textContent = "No supported files selected. Use JPG, PNG, WEBP, HEIC, or HEIF.";
    return;
  }

  const loadedItems = [];
  for (const file of files) {
    try {
      const original = await loadSourceImage(file);
      loadedItems.push({
        id: state.nextId++,
        file,
        original,
        converted: null,
      });
    } catch (error) {
      // Ignore invalid files and continue with the rest.
    }
  }

  if (loadedItems.length === 0) {
    els.summary.textContent = "Selected files could not be decoded. Please retry with different files.";
    return;
  }

  for (const item of loadedItems) {
    state.items.push(item);
    renderOneCard(item);
  }

  updateSummary();
  debouncedRefresh();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function baseName(filename) {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) {
    return filename;
  }
  return filename.slice(0, idx);
}

function downloadConvertedItem(item) {
  const { ext } = getMimeAndExtension(getSettings().format);
  downloadBlob(item.converted.blob, `${baseName(item.file.name)}-converted.${ext}`);
}

function downloadAll() {
  for (const item of state.items) {
    if (!item.converted?.blob) {
      continue;
    }
    downloadConvertedItem(item);
  }
}

function bindEvents() {
  els.dropzone.addEventListener("click", () => els.fileInput.click());
  els.dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      els.fileInput.click();
    }
  });

  els.fileInput.addEventListener("change", async (event) => {
    await handleNewFiles(event.target.files);
    event.target.value = "";
  });

  els.dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropzone.classList.add("is-dragging");
  });

  els.dropzone.addEventListener("dragleave", () => {
    els.dropzone.classList.remove("is-dragging");
  });

  els.dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("is-dragging");
    await handleNewFiles(event.dataTransfer?.files);
  });

  els.lightboxClose.addEventListener("click", closeLightbox);
  els.lightbox.addEventListener("click", (event) => {
    if (event.target === els.lightbox) {
      closeLightbox();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.lightbox.isOpen) {
      closeLightbox();
    }
  });
  window.addEventListener("resize", () => {
    if (state.lightbox.isOpen) {
      updateLightboxSizing();
    }
  });
  els.lightboxImage.addEventListener("load", () => {
    if (state.lightbox.isOpen) {
      updateLightboxSizing();
    }
  });

  els.qualityInput.addEventListener("input", () => {
    updateQualityAvailability();
    debouncedRefresh();
  });

  els.formatSelect.addEventListener("change", () => {
    updateQualityAvailability();
    debouncedRefresh();
  });

  els.resizeMode.addEventListener("change", () => {
    setResizeVisibility();
    debouncedRefresh();
  });

  const resizeInputs = [els.percentInput, els.widthInput, els.heightInput, els.keepAspectInput];
  for (const input of resizeInputs) {
    input.addEventListener("input", debouncedRefresh);
    input.addEventListener("change", debouncedRefresh);
  }

  els.downloadAllBtn.addEventListener("click", downloadAll);
}

function init() {
  setResizeVisibility();
  updateQualityAvailability();
  updateSummary();
  bindEvents();
}

init();
