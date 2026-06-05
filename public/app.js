const REFRESH_MS = 120_000;
const statusEl = document.querySelector("#status");
const bestRainhaEl = document.querySelector("#bestRainha");
const bestFpEl = document.querySelector("#bestFp");
const refreshBtn = document.querySelector("#refresh");
const loginBtn = document.querySelector("#loginBtn");
const modal = document.querySelector("#editorModal");
const loginScreen = document.querySelector("#loginScreen");
const editorScreen = document.querySelector("#editorScreen");
const loginPassword = document.querySelector("#loginPassword");
const submitLogin = document.querySelector("#submitLogin");
const loginError = document.querySelector("#loginError");
const platformEditor = document.querySelector("#platformEditor");
const savePlatforms = document.querySelector("#savePlatforms");
const cancelEdit = document.querySelector("#cancelEdit");
const lists = {
  "Rainha do Slot": document.querySelector("#rainhaList"),
  "Grupo FP Sinais": document.querySelector("#fpList"),
};
const filterButtons = document.querySelectorAll(".filter-btn");

const PLATFORM_STORAGE_KEY = "fbr-platform-cards";
const ADMIN_PASSWORD = "Carol2018*";

let loading = false;
let nextRefreshAt = null;
let adminMode = false;
let currentFilter = "distribuicao";
let currentData = null;
let platformCards = loadPlatforms();

function loadPlatforms() {
  const stored = localStorage.getItem(PLATFORM_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      localStorage.removeItem(PLATFORM_STORAGE_KEY);
    }
  }

  return [
    { title: "Plataforma 1", href: "https://exemplo.com", img: "https://via.placeholder.com/120x120?text=Logo+1" },
    { title: "Plataforma 2", href: "https://exemplo.com", img: "https://via.placeholder.com/120x120?text=Logo+2" },
    { title: "Plataforma 3", href: "https://exemplo.com", img: "https://via.placeholder.com/120x120?text=Logo+3" },
    { title: "Plataforma 4", href: "https://exemplo.com", img: "https://via.placeholder.com/120x120?text=Logo+4" },
  ];
}

function savePlatformsToStorage() {
  localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(platformCards));
}

function renderPlatformCards() {
  const container = document.querySelector(".platform-grid");
  container.innerHTML = platformCards
    .map(
      (platform) => `
        <a class="platform-card" href="${platform.href}" target="_blank" rel="noopener">
          <img src="${platform.img}" alt="${platform.title}">
          <div class="platform-meta">
            <strong>${platform.title}</strong>
          </div>
        </a>`
    )
    .join("");
}

function openModal(screen) {
  modal.classList.remove("hidden");
  loginScreen.classList.toggle("hidden", screen !== "login");
  editorScreen.classList.toggle("hidden", screen !== "editor");
  if (screen === "login") {
    loginPassword.value = "";
    loginError.classList.add("hidden");
  }
}

function closeModal() {
  modal.classList.add("hidden");
}

function buildEditor() {
  platformEditor.innerHTML = platformCards
    .map(
      (platform, index) => `
        <div class="platform-editor-card" data-index="${index}">
          <label>Título</label>
          <input type="text" name="title" value="${platform.title}" placeholder="Título do card">
          <label>Link</label>
          <input type="url" name="href" value="${platform.href}" placeholder="https://...">
          <label>Imagem</label>
          <input type="url" name="img" value="${platform.img}" placeholder="URL da imagem">
        </div>`
    )
    .join("");
}

function attemptLogin() {
  if (loginPassword.value === ADMIN_PASSWORD) {
    adminMode = true;
    openModal("editor");
    buildEditor();
  } else {
    loginError.classList.remove("hidden");
  }
}

function saveEditor() {
  const cards = Array.from(platformEditor.querySelectorAll(".platform-editor-card"));
  platformCards = cards.map((card) => {
    const title = card.querySelector("input[name=title]").value.trim();
    const href = card.querySelector("input[name=href]").value.trim();
    const img = card.querySelector("input[name=img]").value.trim();
    return { title: title || "Novo card", href: href || "#", img: img || "https://via.placeholder.com/120x120?text=Imagem" };
  });
  savePlatformsToStorage();
  renderPlatformCards();
  closeModal();
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function formatBetValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toString().replace(/\.0$/, "") : "0";
}

function renderRow(jogo, index) {
  const img = jogo.imagem_url
    ? `<img class="thumb" src="${jogo.imagem_url}" alt="${jogo.nome}" loading="lazy">`
    : `<div class="thumb"></div>`;

  const minClass = getMetricClass(jogo.aposta_minima);
  const distClass = getMetricClass(jogo.distribuicao);
  const avgClass = getMetricClass(jogo.media);
  const apostaPadrao = jogo.aposta_padrao || jogo.aposta_minima;
  const sugestaoLabel = jogo.aposta_padrao ? "Aposta padrão" : "Aposta mínima";

  return `
    <div class="row">
      <div class="rank">${index + 1}</div>
      ${img}
      <div>
        <div class="name">${jogo.nome}</div>
        <div class="metrics">
          <span class="metric ${minClass}">Minima ${formatPercent(jogo.aposta_minima)}</span>
          <span class="metric ${distClass}">Distrib. ${formatPercent(jogo.distribuicao)}</span>
          <span class="metric ${avgClass}">Media ${Number(jogo.media || 0).toFixed(1)}%</span>
          <span class="metric">${sugestaoLabel} ${formatBetValue(apostaPadrao)}</span>
        </div>
      </div>
    </div>`;
}

function getMetricClass(value) {
  return Number(value) > 97 ? "high" : "";
}

function render(data) {
  currentData = data;
  const rainhaTop = getTopByFilter(data.porSite?.["Rainha do Slot"] || []);
  const fpTop = getTopByFilter(data.porSite?.["Grupo FP Sinais"] || []);

  const rainhaAposta = rainhaTop ? formatBetValue(rainhaTop.aposta_padrao || rainhaTop.aposta_minima) : null;
  const fpAposta = fpTop ? formatBetValue(fpTop.aposta_padrao || fpTop.aposta_minima) : null;

  bestRainhaEl.textContent = rainhaTop
    ? `${rainhaTop.nome} - minima ${formatPercent(rainhaTop.aposta_minima)} | distribuicao ${formatPercent(
        rainhaTop.distribuicao
      )} | media ${Number(rainhaTop.media).toFixed(1)}% | aposta ${rainhaAposta}`
    : "Nenhum jogo encontrado.";

  bestFpEl.textContent = fpTop
    ? `${fpTop.nome} - minima ${formatPercent(fpTop.aposta_minima)} | distribuicao ${formatPercent(
        fpTop.distribuicao
      )} | media ${Number(fpTop.media).toFixed(1)}% | aposta ${fpAposta}`
    : "Nenhum jogo encontrado.";

  updateFilterButtons();
  renderGames();
}

function getTopByFilter(jogos) {
  return sortGamesByFilter(jogos)[0] || null;
}

function renderGames() {
  if (!currentData) return;

  for (const [site, el] of Object.entries(lists)) {
    const jogos = currentData.porSite?.[site] || [];
    const sortedGames = sortGamesByFilter(jogos);
    el.innerHTML = sortedGames.length ? sortedGames.map(renderRow).join("") : `<div class="empty">Nenhum jogo encontrado.</div>`;
  }
}

function sortGamesByFilter(jogos) {
  const ascending = currentFilter === "aposta_minima";
  return [...jogos].sort((a, b) => {
    const aValue = Number(a[currentFilter] ?? 0);
    const bValue = Number(b[currentFilter] ?? 0);
    if (aValue < bValue) return ascending ? -1 : 1;
    if (aValue > bValue) return ascending ? 1 : -1;
    return 0;
  });
}

function updateFilterButtons() {
  filterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === currentFilter);
  });
}

async function atualizar() {
  if (loading) return;
  loading = true;
  refreshBtn.disabled = true;
  statusEl.textContent = "Atualizando dados dos dois sites...";

  try {
    const response = await fetch("/.netlify/functions/jogos", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    render(data);
    nextRefreshAt = Date.now() + REFRESH_MS;
    statusEl.textContent = `Ultima atualizacao: ${new Date(data.atualizado_em).toLocaleTimeString("pt-BR")} | ${
      data.total
    } jogos analisados | proxima em 02:00`;
  } catch (error) {
    statusEl.textContent = `Erro ao atualizar: ${error.message}`;
  } finally {
    loading = false;
    refreshBtn.disabled = false;
  }
}

function tick() {
  if (nextRefreshAt && !loading) {
    const rest = Math.max(0, Math.floor((nextRefreshAt - Date.now()) / 1000));
    const min = String(Math.floor(rest / 60)).padStart(2, "0");
    const sec = String(rest % 60).padStart(2, "0");
    const prefix = statusEl.textContent.split("| proxima")[0].trim();
    statusEl.textContent = `${prefix} | proxima em ${min}:${sec}`;
  }
}

loginBtn.addEventListener("click", () => {
  if (adminMode) {
    openModal("editor");
    buildEditor();
  } else {
    openModal("login");
  }
});

submitLogin.addEventListener("click", attemptLogin);
loginPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") attemptLogin();
});

savePlatforms.addEventListener("click", saveEditor);
cancelEdit.addEventListener("click", closeModal);

document.querySelector("#closeModal").addEventListener("click", closeModal);

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    updateFilterButtons();
    renderGames();
  });
});

refreshBtn.addEventListener("click", atualizar);
setInterval(atualizar, REFRESH_MS);
setInterval(tick, 1000);

// Carousel functionality
const carouselWrapper = document.querySelector(".carousel-wrapper");
const carouselPrev = document.querySelector("#carouselPrev");
const carouselNext = document.querySelector("#carouselNext");

if (carouselPrev && carouselNext && carouselWrapper) {
  const scrollAmount = 200;

  carouselPrev.addEventListener("click", () => {
    carouselWrapper.scrollBy({ left: -scrollAmount, behavior: "smooth" });
  });

  carouselNext.addEventListener("click", () => {
    carouselWrapper.scrollBy({ left: scrollAmount, behavior: "smooth" });
  });
}

renderPlatformCards();
updateFilterButtons();
atualizar();
