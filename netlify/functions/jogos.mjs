import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const RAINHA_LOGIN_EMAIL = process.env.RAINHA_LOGIN_EMAIL || "fabriciomdasilva8@gmail.com";
const RAINHA_LOGIN_PASSWORD = process.env.RAINHA_LOGIN_PASSWORD || "Carol2018*";

let rainhaCookies = null;
let rainhaLoginPromise = null;

const SITES = [
  {
    nome: "Rainha PG Soft",
    url: "https://rainhadoslot.com.br/sinais/pg-soft",
    parser: extrairRainha,
    group: "Rainha do Slot",
    defaultProvider: "PG Soft",
    requiresLogin: true,
  },
  {
    nome: "Rainha Pragmatic",
    url: "https://rainhadoslot.com.br/sinais/pragmatic-play",
    parser: extrairRainha,
    group: "Rainha do Slot",
    defaultProvider: "Pragmatic Play",
    requiresLogin: true,
  },
  {
    nome: "Rainha TaDa",
    url: "https://rainhadoslot.com.br/sinais/tada",
    parser: extrairRainha,
    group: "Rainha do Slot",
    defaultProvider: "TaDa Games",
    requiresLogin: true,
  },
  {
    nome: "FP Todos",
    url: "https://grupofpsinais.bet/",
    parser: extrairFp,
    group: "Grupo FP Sinais",
  },
  {
    nome: "FP Pragmatic",
    url: "https://grupofpsinais.bet/pp-games",
    parser: extrairFp,
    group: "Grupo FP Sinais",
    defaultProvider: "Pragmatic Play",
  },
  {
    nome: "FP WG",
    url: "https://grupofpsinais.bet/wg-games",
    parser: extrairFp,
    group: "Grupo FP Sinais",
    defaultProvider: "WG Games",
  },
  {
    nome: "FP TaDa",
    url: "https://grupofpsinais.bet/tada-games",
    parser: extrairFp,
    group: "Grupo FP Sinais",
    defaultProvider: "TaDa Games",
  },
];

let fpImageMap = null;

export default async function handler() {
  try {
    const resultados = await Promise.all(
      SITES.map(async (site) => {
        try {
          const cookie = site.requiresLogin ? await getRainhaCookie() : null;
          const html = await baixar(site.url, cookie);
          return site.parser(html, site);
        } catch (error) {
          console.error(`Erro ao processar ${site.nome}:`, error.message);
          return [];
        }
      })
    );

    const jogos = resultados.flat();
    const grupos = [...new Set(SITES.map((site) => site.group))];
    
    // Group by site and manufacturer for better categorization
    const porSite = Object.fromEntries(
      grupos.map((group) => {
        const jogosPorGrupo = jogos.filter((jogo) => jogo.site === group);
        
        // For FP Sinais, further group by manufacturer
        if (group === "Grupo FP Sinais") {
          const subgrupos = new Map();
          jogosPorGrupo.forEach(jogo => {
            const fab = jogo.fabricante || "Outros";
            if (!subgrupos.has(fab)) {
              subgrupos.set(fab, []);
            }
            subgrupos.get(fab).push(jogo);
          });
          
          // Return top 25 per manufacturer
          const resultado = {};
          subgrupos.forEach((jogosSubgrupo, fab) => {
            resultado[fab] = melhores(jogosSubgrupo, 25);
          });
          
          return [group, resultado];
        } else {
          return [group, melhores(jogosPorGrupo, 25)];
        }
      })
    );

    return Response.json({
      atualizado_em: new Date().toISOString(),
      total: jogos.length,
      melhor: prepararSaida(melhorJogo(jogos)),
      porSite: Object.fromEntries(
        Object.entries(porSite).map(([site, jogosSite]) => {
          if (site === "Grupo FP Sinais" && typeof jogosSite === "object" && !Array.isArray(jogosSite)) {
            // Handle manufacturer subcategories
            return [site, Object.fromEntries(
              Object.entries(jogosSite).map(([fab, jogos]) => [fab, jogos.map(prepararSaida)])
            )];
          } else {
            // Handle regular arrays
            return [site, Array.isArray(jogosSite) ? jogosSite.map(prepararSaida) : []];
          }
        })
      ),
    });
  } catch (error) {
    console.error("Erro geral:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function baixar(url, cookie) {
  const headers = {
    "user-agent": USER_AGENT,
    "accept-language": "pt-BR,pt;q=0.9",
  };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Falha ao baixar ${url}: ${response.status}`);
  return response.text();
}

async function getRainhaCookie() {
  if (rainhaCookies) return rainhaCookies;
  if (rainhaLoginPromise) return rainhaLoginPromise;
  rainhaLoginPromise = loginRainha().finally(() => {
    rainhaLoginPromise = null;
  });
  return rainhaLoginPromise;
}

function parseSetCookie(raw) {
  if (!raw) return null;
  const entries = Array.isArray(raw) ? raw : String(raw).split(/,(?=[^\s][^=]+=)/g);
  return entries
    .map((entry) => entry.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function loginRainha() {
  if (!RAINHA_LOGIN_EMAIL || !RAINHA_LOGIN_PASSWORD) {
    throw new Error("Credenciais Rainha não fornecidas em RAINHA_LOGIN_EMAIL/RAINHA_LOGIN_PASSWORD");
  }

  const response = await fetch("https://rainhadoslot.com.br/ajax/login.php", {
    method: "POST",
    headers: {
      "user-agent": USER_AGENT,
      "accept": "application/json, text/plain, */*",
      "accept-language": "pt-BR,pt;q=0.9",
      "content-type": "application/x-www-form-urlencoded",
      "referer": "https://rainhadoslot.com.br/",
    },
    body: new URLSearchParams({ email: RAINHA_LOGIN_EMAIL, senha: RAINHA_LOGIN_PASSWORD }),
  });

  if (!response.ok) throw new Error(`Falha no login Rainha: ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error(`Login Rainha falhou: ${data.message || "erro desconhecido"}`);

  let cookies = null;
  if (typeof response.headers.get === "function") {
    const rawHeader = response.headers.get("set-cookie");
    cookies = parseSetCookie(rawHeader);
  }

  if ((!cookies || !cookies.length) && typeof response.headers.raw === "function") {
    const rawHeaders = response.headers.raw();
    cookies = parseSetCookie(rawHeaders["set-cookie"] || []);
  }

  if (!cookies) throw new Error("Não foi possível obter cookies de login Rainha");
  rainhaCookies = cookies;
  return cookies;
}

function normalizeProviderName(value) {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  if (!lower) return null;
  if (lower.includes("pg")) return "PG Soft";
  if (lower.includes("pragmatic")) return "Pragmatic Play";
  if (lower.includes("wg")) return "WG Games";
  if (lower.includes("tada")) return "TaDa Games";
  return text;
}

function buscarProvider(fragment) {
  if (!fragment) return null;
  const patterns = [
    /\\"(?:fabricante|provedor|provider|fornecedor|brand)\\"\s*:\s*\\"(?<value>.*?)\\"/i,
    /"(?:fabricante|provedor|provider|fornecedor|brand)"\s*:\s*"(?<value>.*?)"/i,
    /"categoriaJogo"\s*:\s*"(?<value>.*?)"/i,
    /"categoria"\s*:\s*"(?<value>.*?)"/i,
    /(?:fabricante|provedor|provider|fornecedor|brand)[^>]*>\s*(?<value>PG Soft|Pragmatic Play|Pragmatic|WG Games|TaDa Games|Tada Games|WG|TaDa|PG)\s*</i,
    /(?<value>PG Soft|Pragmatic Play|Pragmatic|WG Games|TaDa Games|Tada Games)\s*[-–—]\s*Atualiza/i,
  ];

  for (const pattern of patterns) {
    const match = fragment.match(pattern);
    if (match?.groups?.value) return normalizeProviderName(match.groups.value);
  }

  return null;
}

function extrairProviderRainha($, html) {
  const activeText = $('[class*=active], .selected').text();
  return buscarProvider(activeText) || buscarProvider(html);
}

function extrairRainha(html, site) {
  const $ = cheerio.load(html);
  const provider = site.defaultProvider || extrairProviderRainha($, html);
  const jogos = [];

  $("h3[data-name], h3.game-title, h3").each((_, titulo) => {
    const $titulo = $(titulo);
    const nome = limparTexto($titulo.attr("data-name") || $titulo.text());
    if (!nome) return;

    let card = $titulo;
    for (let i = 0; i < 6; i += 1) {
      card = card.parent();
      const texto = limparTexto(card.text());
      if (texto.includes("Aposta Mínima") || texto.includes("Aposta Minima")) break;
    }

    const texto = limparTexto(card.text());
    const apostaMinima = parseFloatTexto(buscarRotulo(texto, ["Aposta Mínima", "Aposta Minima"]));
    if (apostaMinima == null) return;

    // Tentar extrair imagem por vários locais: <img>, srcset, <source>, style background, data-attrs
    let src = null;
    const img = card.find("img").first();
    if (img && img.length) {
      src = img.attr("src") || img.attr("data-src") || img.attr("data-original") || img.attr("data-lazy") || null;
      if (!src) {
        const srcset = img.attr("srcset") || img.attr("data-srcset") || img.attr("data-srcset-mobile");
        if (srcset) {
          // pegar primeira URL do srcset
          const first = String(srcset).split(",")[0].trim().split(" ")[0];
          if (first) src = first;
        }
      }
    }
    if (!src) {
      const source = card.find("source").first();
      if (source && source.length) {
        src = source.attr("src") || source.attr("srcset") || null;
        if (src && src.includes(",")) src = String(src).split(",")[0].trim().split(" ")[0];
      }
    }
    if (!src) {
      // procurar style="background-image: url('...')"
      const styled = card.find("[style*='url(']").first();
      if (styled && styled.length) {
        const styleVal = styled.attr("style") || "";
        const m = styleVal.match(/url\((?:'|\")?([^)'\"\s]+)(?:'|\")?\)/);
        if (m) src = m[1];
      }
    }
    if (!src) {
      // atributos customizados
      const dataBg = card.find("[data-bg]").first();
      if (dataBg && dataBg.length) src = dataBg.attr("data-bg") || null;
      if (!src) {
        const dataImage = card.find("[data-image]").first();
        if (dataImage && dataImage.length) src = dataImage.attr("data-image") || null;
      }
    }

    // Fallback: procurar no HTML por URLs de thumbs próximas ao nome do jogo
    if (!src) {
      try {
        const idx = html.indexOf(nome);
        if (idx !== -1) {
          const start = Math.max(0, idx - 500);
          const end = Math.min(html.length, idx + 500);
          const window = html.slice(start, end);
          const regex = /(https?:\/\/[^"'\s]*\/sinais\/static\/image\/[^"'\s]+)|(\/sinais\/static\/image\/[^"'\s]+)/i;
          const m = window.match(regex);
          if (m) {
            src = m[1] || (m[2] ? new URL(m[2], site.url).toString() : null);
          }
        }
      } catch (e) {
        // ignorar
      }
    }

    jogos.push({
      site: site.group,
      nome,
      fabricante: provider,
      aposta_minima: apostaMinima,
      aposta_padrao: parseFloatTexto(buscarRotulo(texto, ["Aposta Padrão", "Aposta Padrao"])),
      aposta_maxima: parseFloatTexto(buscarRotulo(texto, ["Aposta Máxima", "Aposta Maxima"])),
      distribuicao: parseFloatTexto(buscarRotulo(texto, ["Distribuição", "Distribuicao"])),
      imagem_url: src ? new URL(src, site.url).toString() : null,
    });
  });

  return removerDuplicados(jogos);
}

async function obterMapaFp() {
  if (fpImageMap) return fpImageMap;

  const js = await baixar("https://grupofpsinais.bet/_next/static/chunks/338-d4c371ad1ff8b3e6.js");
  const mapa = new Map();
  const regex = /(\d+):\{image:"([^"]+)",icon:"([^"]+)"\}/g;
  for (const match of js.matchAll(regex)) {
    mapa.set(Number(match[1]), new URL(match[2], "https://grupofpsinais.bet").toString());
  }
  fpImageMap = mapa;
  return fpImageMap;
}

async function extrairFp(html, site) {
  const imagens = await obterMapaFp();
  const pageProvider = site.defaultProvider || buscarProvider(html);
  const jogos = [];
  const regex =
    /\\"id\\":(?<id>\d+).{0,300}?\\"nomeJogo\\":\\"(?<nome>.*?)(?<!\\)\\".{0,600}?\\"porcentagem\\":(?<porcentagem>\d+).{0,300}?\\"minima\\":(?<minima>\d+).{0,300}?\\"padrao\\":(?<padrao>\d+).{0,300}?\\"maxima\\":(?<maxima>\d+)/gs;

  for (const match of html.matchAll(regex)) {
    const id = Number(match.groups.id);
    const nome = decodificarJson(match.groups.nome);
    const fragment = html.slice(Math.max(0, match.index - 200), match.index + 600);
    const fabricante = site.defaultProvider ? site.defaultProvider : buscarProvider(fragment) || pageProvider;
    jogos.push({
      site: site.group,
      nome,
      fabricante,
      aposta_minima: Number(match.groups.minima),
      aposta_padrao: Number(match.groups.padrao),
      aposta_maxima: Number(match.groups.maxima),
      distribuicao: Number(match.groups.porcentagem),
      imagem_url: imagens.get(id) || null,
    });
  }

  return removerDuplicados(jogos);
}

function decodificarJson(texto) {
  try {
    return JSON.parse(`"${texto.replaceAll("\\/", "/")}"`);
  } catch {
    return texto.replaceAll('\\"', '"');
  }
}

function limparTexto(texto = "") {
  return texto.replace(/\s+/g, " ").trim();
}

function parseFloatTexto(texto) {
  if (!texto) return null;
  const match = String(texto).match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : null;
}

function buscarRotulo(texto, rotulos) {
  for (const rotulo of rotulos) {
    const escaped = rotulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = texto.match(new RegExp(`${escaped}\\s*:?\\s*(\\d+(?:[.,]\\d+)?)\\s*%?`, "i"));
    if (match) return match[1];
  }
  return null;
}

function distancia100(jogo) {
  return Math.abs(100 - Number(jogo.aposta_minima || 0)) + Math.abs(100 - Number(jogo.distribuicao || 0));
}

function media(jogo) {
  return (Number(jogo.aposta_minima || 0) + Number(jogo.distribuicao || 0)) / 2;
}

function melhores(jogos, limite) {
  return [...jogos].sort((a, b) => distancia100(a) - distancia100(b)).slice(0, limite);
}

function melhorJogo(jogos) {
  return melhores(jogos, 1)[0] || null;
}

function prepararSaida(jogo) {
  if (!jogo) return null;
  return {
    ...jogo,
    media: media(jogo),
    pontuacao: distancia100(jogo),
  };
}

function removerDuplicados(jogos) {
  const vistos = new Set();
  return jogos.filter((jogo) => {
    const chave = `${jogo.site}:${jogo.nome.toLowerCase()}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}
