import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const SITES = [
  {
    nome: "Rainha do Slot",
    url: "https://rainhadoslot.com.br",
    parser: extrairRainha,
  },
  {
    nome: "Grupo FP Sinais",
    url: "https://grupofpsinais.bet",
    parser: extrairFp,
  },
];

let fpImageMap = null;

export default async function handler() {
  try {
    const resultados = await Promise.all(
      SITES.map(async (site) => {
        const html = await baixar(site.url);
        return site.parser(html, site);
      })
    );

    const jogos = resultados.flat();
    const porSite = Object.fromEntries(
      SITES.map((site) => [site.nome, melhores(jogos.filter((jogo) => jogo.site === site.nome), 10)])
    );

    return Response.json({
      atualizado_em: new Date().toISOString(),
      total: jogos.length,
      melhor: prepararSaida(melhorJogo(jogos)),
      porSite: Object.fromEntries(
        Object.entries(porSite).map(([site, jogosSite]) => [site, jogosSite.map(prepararSaida)])
      ),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function baixar(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      "accept-language": "pt-BR,pt;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`Falha ao baixar ${url}: ${response.status}`);
  return response.text();
}

function extrairRainha(html, site) {
  const $ = cheerio.load(html);
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

    const img = card.find("img").first();
    const src = img.attr("src") || img.attr("data-src") || null;

    jogos.push({
      site: site.nome,
      nome,
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
  const jogos = [];
  const regex =
    /\\"id\\":(?<id>\d+).{0,300}?\\"nomeJogo\\":\\"(?<nome>.*?)(?<!\\)\\".{0,600}?\\"porcentagem\\":(?<porcentagem>\d+).{0,300}?\\"minima\\":(?<minima>\d+).{0,300}?\\"padrao\\":(?<padrao>\d+).{0,300}?\\"maxima\\":(?<maxima>\d+)/gs;

  for (const match of html.matchAll(regex)) {
    const id = Number(match.groups.id);
    const nome = decodificarJson(match.groups.nome);
    jogos.push({
      site: site.nome,
      nome,
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
