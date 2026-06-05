/*
  public/app.js

  Este arquivo controla a lógica de renderização e atualização do dashboard.
  Principais responsabilidades:
    1. Estado global e seleção de elementos HTML
    2. Carregamento e salvamento de cards da plataforma
    3. Renderização dos cards de plataforma e lista de jogos
    4. Filtros de ordenação e atualização automática
    5. Modal de administrador para editar cards
*/

// === CONFIGURAÇÕES E SELETORES PRINCIPAIS ===
// Tempo de atualização automática em milissegundos (2 minutos).
const REFRESH_MS = 120_000;

// Elementos de interface usados para atualizar texto e estado.
const statusEl = document.querySelector("#status");
const refreshBtn = document.querySelector("#refresh");
const scrollTopBtn = document.querySelector("#scrollTopBtn");
const modal = document.querySelector("#editorModal");
const loginScreen = document.querySelector("#loginScreen");
const editorScreen = document.querySelector("#editorScreen");
const loginPassword = document.querySelector("#loginPassword");
const submitLogin = document.querySelector("#submitLogin");
const loginError = document.querySelector("#loginError");
const platformEditor = document.querySelector("#platformEditor");
const savePlatforms = document.querySelector("#savePlatforms");
const cancelEdit = document.querySelector("#cancelEdit");

// Referências para as duas listas de jogos exibidas na página.
const lists = {
  "Rainha do Slot": document.querySelector("#rainhaList"),
  "Grupo FP Sinais": document.querySelector("#fpList"),
};

const filterButtons = document.querySelectorAll(".filter-btn");
const siteFilterButtons = document.querySelectorAll(".site-filter-btn");
const rainhaPanel = document.querySelector("#rainhaPanel");
const fpPanel = document.querySelector("#fpPanel");

// Chaves de armazenamento e senha do modo administrador.
const PLATFORM_STORAGE_KEY = "fbr-platform-cards";
const ADMIN_PASSWORD = "Carol2018*";

// Estado global do aplicativo.
let loading = false; // impede atualizações concorrentes.
let nextRefreshAt = null; // próximo tempo de atualização automática.
let adminMode = false; // flag para exibir editor de cards.
let currentFilter = "distribuicao"; // filtro de ordenação ativo.
let currentSite = "fp"; // filtro de site para os cards.
let currentData = null; // dados atuais carregados da API.
let platformCards = await loadPlatforms(); // cards da seção de plataformas.

// Carrega os cards de plataforma salvos no storage ou usa o arquivo de configuração.
async function loadPlatforms() {
  const stored = localStorage.getItem(PLATFORM_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // Se o JSON estiver corrompido, apaga o valor salvo e usa os padrões.
      localStorage.removeItem(PLATFORM_STORAGE_KEY);
    }
  }

  try {
    const response = await fetch("/platforms.json", { cache: "no-store" });
    if (response.ok) {
      const platforms = await response.json();
      if (Array.isArray(platforms)) return platforms;
    }
  } catch {
    // Falha no fetch, cai para o padrão embutido.
  }

  // Cards padrão exibidos quando não existe nada salvo e o arquivo não pôde ser carregado.
  return [
    { title: "Plataforma 1", href: "https://exemplo.com", img: "https://via.placeholder.com/120x120?text=Logo+1" },
    { title: "Plataforma 2", href: "https://exemplo.com", img: "https://via.placeholder.com/120x120?text=Logo+2" },
    { title: "Plataforma 3", href: "https://exemplo.com", img: "https://via.placeholder.com/120x120?text=Logo+3" },
    { title: "Plataforma 4", href: "https://exemplo.com", img: "https://via.placeholder.com/120x120?text=Logo+4" },
  ];
}

// Salva o array de cards de plataforma no localStorage para manter as mudanças entre sessões.
function savePlatformsToStorage() {
  localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(platformCards));
}

// Renderiza os cards de plataforma em grade simples.
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

// Abre o modal e escolhe qual tela exibir: login ou editor.
function openModal(screen) {
  modal.classList.remove("hidden");
  loginScreen.classList.toggle("hidden", screen !== "login");
  editorScreen.classList.toggle("hidden", screen !== "editor");
  if (screen === "login") {
    loginPassword.value = "";
    loginError.classList.add("hidden");
  }
}

// Fecha o modal independente da tela interna atual.
function closeModal() {
  modal.classList.add("hidden");
}

// Constrói os campos do editor com os dados atuais dos cards de plataforma.
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

// Tenta autenticar o administrador usando a senha fixa definida em ADMIN_PASSWORD.
function attemptLogin() {
  if (loginPassword.value === ADMIN_PASSWORD) {
    adminMode = true;
    openModal("editor");
    buildEditor();
  } else {
    loginError.classList.remove("hidden");
  }
}

// Salva as alterações feitas no editor convertendo os campos em objetos de carta.
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
  if (!Number.isFinite(number)) return "0";
  return number.toString().replace(/\.0$/, "");
}

// Renderiza um único card de jogo, incluindo imagem de fundo, distribuição e barras de valor.
function renderRow(jogo, index) {
  const distributionValue = Number(jogo.distribuicao || 0);
  const minValue = Number(jogo.aposta_minima || 0);
  const padraoValue = Number(jogo.aposta_padrao || 0);
  const maxValue = Number(jogo.aposta_maxima || 0);

  // Garantir que a largura da barra fique entre 8% e 100%.
  const minWidth = Math.min(100, Math.max(8, minValue));
  const padraoWidth = Math.min(100, Math.max(8, padraoValue));
  const maxWidth = Math.min(100, Math.max(8, maxValue));
  const backgroundImage = jogo.imagem_url ? `url('${jogo.imagem_url}')` : "none";

  return `
    <div class="row" style="--row-image: ${backgroundImage}">
      <div class="row-content">
        <div class="rank">
          <span>Dist.</span>
          <strong>${formatPercent(distributionValue)}</strong>
        </div>
        <div class="name">${jogo.nome}</div>
        <div class="stats-card">
          <div class="stat-row">
            <span>Mínima</span>
            <strong>${formatPercent(minValue)}</strong>
          </div>
          <div class="stat-bar"><span class="stat-fill min" style="width:${minWidth}%"></span></div>
          <div class="stat-row">
            <span>Padrão</span>
            <strong>${formatPercent(padraoValue)}</strong>
          </div>
          <div class="stat-bar"><span class="stat-fill padrao" style="width:${padraoWidth}%"></span></div>
          <div class="stat-row">
            <span>Máxima</span>
            <strong>${formatPercent(maxValue)}</strong>
          </div>
          <div class="stat-bar"><span class="stat-fill max" style="width:${maxWidth}%"></span></div>
        </div>
      </div>
    </div>`;
}

// Função auxiliar para aplicar classe extra em métricas muito altas.
// Atualmente não usada diretamente, mas pode servir para destacar valores > 97.
function getMetricClass(value) {
  return Number(value) > 97 ? "high" : "";
}

// Atualiza os textos e listas principais após receber dados da API.
function render(data) {
  currentData = data;

  // Computa os melhores jogos por cada site usando o filtro atual.
  updateFilterButtons();
  updateSiteFilterButtons();
  renderGames();
}

// Retorna o jogo de maior valor com base no filtro atual.
function getTopByFilter(jogos) {
  return sortGamesByFilter(jogos)[0] || null;
}

// Renderiza todas as listas de jogos na página, uma por site.
function renderGames() {
  if (!currentData) return;

  for (const [site, el] of Object.entries(lists)) {
    const jogos = currentData.porSite?.[site] || [];
    const sortedGames = sortGamesByFilter(jogos);
    el.innerHTML = sortedGames.length ? sortedGames.map(renderRow).join("") : `<div class="empty">Nenhum jogo encontrado.</div>`;
  }
}

// Ordena os jogos de forma decrescente de acordo com o filtro atual.
function sortGamesByFilter(jogos) {
  return [...jogos].sort((a, b) => {
    const aValue = Number(a[currentFilter] ?? 0) || 0;
    const bValue = Number(b[currentFilter] ?? 0) || 0;
    if (aValue < bValue) return 1;
    if (aValue > bValue) return -1;
    return 0;
  });
}

// Atualiza o botão ativo conforme o filtro selecionado.
function updateFilterButtons() {
  filterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === currentFilter);
  });
}

function updateSiteFilterButtons() {
  siteFilterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.site === currentSite);
  });

  if (currentSite === "rainha") {
    rainhaPanel.classList.remove("hidden");
    fpPanel.classList.add("hidden");
  } else if (currentSite === "fp") {
    rainhaPanel.classList.add("hidden");
    fpPanel.classList.remove("hidden");
  } else {
    rainhaPanel.classList.remove("hidden");
    fpPanel.classList.remove("hidden");
  }
}

// Requisição de atualização de dados para o endpoint Netlify.
// Controle de estado garante que não haja duas atualizações ao mesmo tempo.
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

// Atualiza o contador exibido no status para mostrar o tempo restante até a próxima atualização.
function tick() {
  if (nextRefreshAt && !loading) {
    const rest = Math.max(0, Math.floor((nextRefreshAt - Date.now()) / 1000));
    const min = String(Math.floor(rest / 60)).padStart(2, "0");
    const sec = String(rest % 60).padStart(2, "0");
    const prefix = statusEl.textContent.split("| proxima")[0].trim();
    statusEl.textContent = `${prefix} | proxima em ${min}:${sec}`;
  }
}

// Event listeners que ligam ações do usuário às funções.
submitLogin.addEventListener("click", attemptLogin);
loginPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") attemptLogin();
});

savePlatforms.addEventListener("click", saveEditor);
cancelEdit.addEventListener("click", closeModal);

document.querySelector("#closeModal").addEventListener("click", closeModal);

// Adiciona comportamento aos botões de filtro: troca o filtro ativo e re-renderiza os jogos.
filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    updateFilterButtons();
    renderGames();
  });
});

siteFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const selectedSite = button.dataset.site;
    currentSite = currentSite === selectedSite ? "all" : selectedSite;
    updateSiteFilterButtons();
    renderGames();
  });
});

// Atualização manual por clique e atualização automática periódica.
refreshBtn.addEventListener("click", atualizar);
scrollTopBtn?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
window.addEventListener("scroll", () => {
  if (!scrollTopBtn) return;
  scrollTopBtn.classList.toggle("hidden", window.pageYOffset < 280);
});

setInterval(atualizar, REFRESH_MS);
setInterval(tick, 1000);

renderPlatformCards();
updateSiteFilterButtons();
updateFilterButtons();
atualizar();
