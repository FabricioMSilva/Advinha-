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

// Referências para a lista combinada de jogos.
const combinedList = document.querySelector("#combinedList");

const providerSelect = document.querySelector("#providerSelect");

// Chaves de armazenamento e senha do modo administrador.
const PLATFORM_STORAGE_KEY = "fbr-platform-cards";
const ADMIN_PASSWORD = "Carol2018*";

// Estado global do aplicativo.
let loading = false; // impede atualizações concorrentes.
let nextRefreshAt = null; // próximo tempo de atualização automática.
let adminMode = false; // flag para exibir editor de cards.
let currentFilter = "distribuicao"; // filtro de ordenação ativo - FIXO em distribuição depois mínima.
let currentProvider = "all"; // filtro de fabricante para os jogos.
let currentData = null; // dados atuais carregados da API.
let platformCards = await loadPlatforms(); // cards da seção de plataformas.
let sortOrder = []; // rastreia a ordem de cliques dos botões de ordenação (ex: ['distribuicao', 'aposta_minima'])

function isValidPlatform(platform) {
  return (
    platform &&
    typeof platform.title === "string" &&
    platform.title.trim() &&
    typeof platform.href === "string" &&
    platform.href.trim() &&
    typeof platform.img === "string" &&
    platform.img.trim()
  );
}

// Carrega os cards de plataforma salvos no storage ou usa o arquivo de configuração.
async function loadPlatforms() {
  const stored = localStorage.getItem(PLATFORM_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every(isValidPlatform)) {
        return parsed;
      }
      localStorage.removeItem(PLATFORM_STORAGE_KEY);
    } catch {
      // Se o JSON estiver corrompido, apaga o valor salvo e usa os padrões.
      localStorage.removeItem(PLATFORM_STORAGE_KEY);
    }
  }

  try {
    const response = await fetch("/platforms.json", { cache: "no-store" });
    if (response.ok) {
      const platforms = await response.json();
      if (Array.isArray(platforms) && platforms.every(isValidPlatform)) return platforms;
    }
  } catch {
    // Falha no fetch, cai para o padrão embutido.
  }

  // Cards padrão exibidos quando não existe nada salvo e o arquivo não pôde ser carregado.
  return [
    { title: "Plataforma 1", href: "https://example.com", img: "https://via.placeholder.com/120x120?text=Logo+1" },
    { title: "Plataforma 2", href: "https://example.com", img: "https://via.placeholder.com/120x120?text=Logo+2" },
    { title: "Plataforma 3", href: "https://example.com", img: "https://via.placeholder.com/120x120?text=Logo+3" },
    { title: "Plataforma 4", href: "https://example.com", img: "https://via.placeholder.com/120x120?text=Logo+4" },
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

function normalizeProviderName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("pragmatic")) return "pragmatic";
  if (/\bpg\b/.test(normalized)) return "pg";
  if (/\bwg\b/.test(normalized)) return "wg";
  if (normalized.includes("tada")) return "tada";
  return normalized.replace(/\s+/g, "-");
}

function getStatGradient(value) {
  const normalized = Math.min(100, Math.max(0, Number(value) || 0));

  if (normalized >= 95) {
    const lightness = 48 + ((normalized - 95) / 5) * 8;
    return `linear-gradient(90deg, hsl(145, 92%, ${lightness}%), hsl(160, 95%, ${Math.max(42, lightness - 8)}%))`;
  }

  if (normalized >= 75) {
    const hue = 45 + ((normalized - 75) / 20) * 14;
    return `linear-gradient(90deg, hsl(${hue}, 95%, 55%), hsl(${Math.max(32, hue - 9)}, 88%, 46%))`;
  }

  const lightness = 46 + (normalized / 75) * 8;
  return `linear-gradient(90deg, hsl(1, 93%, ${Math.min(62, lightness + 6)}%), hsl(10, 85%, ${Math.max(35, lightness - 8)}%))`;
}

// Função para envolver URLs de imagens em um proxy CORS-amigável
// Nota: As imagens originais têm bloqueio CORS rigoroso.
// Os cards aparecem com gradiente bonito como fallback.
function proxyImageUrl(url) {
  if (!url) return null;
  // Graceful degradation - retornar null e deixar apenas o gradiente
  // (Em produção, seria necessário um proxy server-side para contornar CORS)
  try {
    // Corrige URLs sem protocolo (//example.com/path)
    if (url.startsWith("//")) url = window.location.protocol + url;
    // Se for URL relativa, converte para absoluta baseada na origem atual
    if (!/^https?:\/\//i.test(url)) {
      url = new URL(url, window.location.href).toString();
    }
    // Usar proxy serverless para evitar problemas de hotlink/CORS
    return `/.netlify/functions/image?u=${encodeURIComponent(url)}`;
  } catch (e) {
    return null;
  }
}

// Renderiza um único card de jogo, incluindo imagem de fundo, distribuição e barras de valor.
// Agora com indicação da origem (Rainha/FP).
function renderRow(jogo, index) {
  const distributionValue = Number(jogo.distribuicao || 0);
  const minValue = Number(jogo.aposta_minima || 0);
  const padraoValue = Number(jogo.aposta_padrao || 0);
  const maxValue = Number(jogo.aposta_maxima || 0);

  // Determinar a origem (Rainha ou FP)
  const origem = jogo.site === "Rainha do Slot" ? "análise de Rainha" : "análise de FP";

  // Garantir que a largura da barra fique entre 8% e 100%.
  const minWidth = Math.min(100, Math.max(8, minValue));
  const padraoWidth = Math.min(100, Math.max(8, padraoValue));
  const maxWidth = Math.min(100, Math.max(8, maxValue));
  const proxiedImageUrl = proxyImageUrl(jogo.imagem_url);
  const backgroundImage = proxiedImageUrl ? `url('${proxiedImageUrl}')` : "none";

  return `
    <div class="row" style="--row-image: ${backgroundImage}">
      <div class="row-content">
        <div class="rank">
          <span>Dist.</span>
          <strong>${formatPercent(distributionValue)}</strong>
        </div>
        <div class="name">${jogo.nome}</div>
        ${jogo.fabricante ? `<div class="provider-badge">${jogo.fabricante}</div>` : ""}
        <div class="stats-card">
          <div class="stat-row">
            <span>Mínima</span>
            <strong>${formatPercent(minValue)}</strong>
          </div>
          <div class="stat-bar"><span class="stat-fill min" style="width:${minWidth}%; background:${getStatGradient(minValue)}"></span></div>
          <div class="stat-row">
            <span>Padrão</span>
            <strong>${formatPercent(padraoValue)}</strong>
          </div>
          <div class="stat-bar"><span class="stat-fill padrao" style="width:${padraoWidth}%; background:${getStatGradient(padraoValue)}"></span></div>
          <div class="stat-row">
            <span>Máxima</span>
            <strong>${formatPercent(maxValue)}</strong>
          </div>
          <div class="stat-bar"><span class="stat-fill max" style="width:${maxWidth}%; background:${getStatGradient(maxValue)}"></span></div>
        </div>
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.85rem; color: rgba(255,255,255,0.6);">${origem}</div>
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

  // Computa os melhores jogos combinados usando o filtro atual.
  buildProviderSelectOptions();
  renderGames();
}

// Retorna o jogo de maior valor com base no filtro atual.
function getTopByFilter(jogos) {
  return sortGamesByFilter(jogos)[0] || null;
}

// Renderiza uma lista única com todos os jogos combinados de ambos sites.
function renderGames() {
  if (!currentData || !combinedList) return;

  // Combinar todos os jogos de ambos os sites
  const allGames = [];
  for (const [site, jogosSiteData] of Object.entries(currentData.porSite || {})) {
    // Handle nested structure (FP Sinais) or flat array (Rainha do Slot)
    if (Array.isArray(jogosSiteData)) {
      allGames.push(...(jogosSiteData || []));
    } else {
      // For object structures (manufacturer subcategories), flatten them
      for (const [fab, jogosArray] of Object.entries(jogosSiteData || {})) {
        allGames.push(...(jogosArray || []));
      }
    }
  }

  // Filtrar por fabricante
  const filteredGames = allGames.filter(
    (jogo) => currentProvider === "all" || normalizeProviderName(jogo.fabricante) === currentProvider
  );

  // Ordenar usando a sequência personalizada de sortOrder, ou padrão se vazio
  const defaultOrder = ["distribuicao", "aposta_minima"];
  const orderToUse = sortOrder.length > 0 ? [...sortOrder, ...defaultOrder.filter((field) => !sortOrder.includes(field))] : defaultOrder;

  const sortedGames = filteredGames.sort((a, b) => {
    for (const field of orderToUse) {
      const aVal = Number(a[field] ?? 0) || 0;
      const bVal = Number(b[field] ?? 0) || 0;
      if (aVal !== bVal) {
        return bVal - aVal; // maior valor primeiro (DESC)
      }
    }
    return 0; // são iguais em todos os critérios
  });

  combinedList.innerHTML = sortedGames.length
    ? sortedGames.map(renderRow).join("")
    : `<div class="empty">Nenhum jogo encontrado.</div>`;
}

// Ordena os jogos de forma decrescente por distribuição, depois por aposta_minima.
function sortGamesByFilter(jogos) {
  return [...jogos].sort((a, b) => {
    const aDist = Number(a.distribuicao ?? 0) || 0;
    const bDist = Number(b.distribuicao ?? 0) || 0;
    if (aDist !== bDist) return bDist - aDist; // distribuição maior primeiro
    const aMin = Number(a.aposta_minima ?? 0) || 0;
    const bMin = Number(b.aposta_minima ?? 0) || 0;
    return bMin - aMin; // aposta_minima maior primeiro
  });
}


function getProviderLabel(normalized, rawName) {
  const mapping = {
    pg: "PG",
    pragmatic: "Pragmatic",
    wg: "WG",
    tada: "TaDa",
  };
  if (mapping[normalized]) return mapping[normalized];
  if (rawName) return String(rawName).trim();
  return normalized.replace(/[-_]/g, " ");
}

function buildProviderSelectOptions() {
  if (!currentData || !providerSelect) return;

  // Coletar todos os provedores de ambos os sites
  const providers = new Map();
  for (const [site, jogosSiteData] of Object.entries(currentData.porSite || {})) {
    let jogosArray = [];
    // Handle nested structure (FP Sinais) or flat array (Rainha do Slot)
    if (Array.isArray(jogosSiteData)) {
      jogosArray = jogosSiteData;
    } else {
      // For object structures (manufacturer subcategories), flatten them
      for (const [fab, jogos] of Object.entries(jogosSiteData || {})) {
        jogosArray.push(...(jogos || []));
      }
    }
    
    jogosArray.forEach((jogo) => {
      const key = normalizeProviderName(jogo.fabricante);
      if (!key || key === "unknown") return;
      if (!providers.has(key)) providers.set(key, getProviderLabel(key, jogo.fabricante));
    });
  }

  const order = ["pg", "pragmatic", "wg", "tada"];
  const orderedKeys = [...new Set(order.filter((key) => providers.has(key)).concat([...providers.keys()].filter((key) => !order.includes(key))))];

  providerSelect.innerHTML = [
    `<option value="all">Todos</option>`,
    ...orderedKeys.map((key) => `<option value="${key}">${providers.get(key)}</option>`),
  ].join("");

  if (orderedKeys.includes(currentProvider)) {
    providerSelect.value = currentProvider;
  } else {
    currentProvider = "all";
    providerSelect.value = "all";
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
if (submitLogin) submitLogin.addEventListener("click", attemptLogin);
if (loginPassword) loginPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") attemptLogin();
});

if (savePlatforms) savePlatforms.addEventListener("click", saveEditor);
if (cancelEdit) cancelEdit.addEventListener("click", closeModal);

const closeModalBtn = document.querySelector("#closeModal");
if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);

if (providerSelect) providerSelect.addEventListener("change", () => {
  currentProvider = providerSelect.value;
  renderGames();
});

// Atualização manual por clique e atualização automática periódica.
// === GERENCIAMENTO DE ORDENAÇÃO CUSTOMIZÁVEL ===

// Função para rastrear a ordem de cliques e atualizar UI dos botões
function handleSortButtonClick(e) {
  const btn = e.currentTarget;
  const sortField = btn.dataset.sort;

  if (!sortField) return;

  // Se o botão já está na lista, remove (toogle)
  const idx = sortOrder.indexOf(sortField);
  if (idx !== -1) {
    sortOrder.splice(idx, 1);
  } else {
    // Adiciona à lista de ordenação
    sortOrder.push(sortField);
  }

  updateSortButtonsUI();
  renderGames(); // re-renderiza com nova ordem
}

// Função para atualizar a UI dos botões (mostrar ordem numérica)
function updateSortButtonsUI() {
  const buttons = document.querySelectorAll(".sort-btn");
  buttons.forEach((btn) => {
    const sortField = btn.dataset.sort;
    const orderSpan = btn.querySelector(".sort-order");
    const idx = sortOrder.indexOf(sortField);

    if (idx !== -1) {
      // Botão está ativo
      btn.classList.add("active");
      orderSpan.classList.remove("hidden");
      orderSpan.textContent = idx + 1; // mostrar 1, 2, 3, 4...
    } else {
      // Botão não está ativo
      btn.classList.remove("active");
      orderSpan.classList.add("hidden");
      orderSpan.textContent = "";
    }
  });
}

// Função para limpar a ordenação e voltar ao padrão (distribuição + mínima)
function resetSortOrder() {
  sortOrder = [];
  updateSortButtonsUI();
  renderGames();
}

// Attach event listeners aos botões de ordenação
const sortButtons = document.querySelectorAll(".sort-btn");
const resetSortBtn = document.querySelector("#resetSort");
sortButtons.forEach((btn) => btn.addEventListener("click", handleSortButtonClick));
if (resetSortBtn) resetSortBtn.addEventListener("click", resetSortOrder);

// === FIM GERENCIAMENTO DE ORDENAÇÃO ===

refreshBtn.addEventListener("click", atualizar);
scrollTopBtn?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
window.addEventListener("scroll", () => {
  if (!scrollTopBtn) return;
  scrollTopBtn.classList.toggle("hidden", window.pageYOffset < 280);
});

setInterval(atualizar, REFRESH_MS);
setInterval(tick, 1000);

renderPlatformCards();
buildProviderSelectOptions();
atualizar();
