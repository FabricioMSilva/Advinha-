import argparse
import csv
import html
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait
    from webdriver_manager.chrome import ChromeDriverManager

    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False


CSV_FILE = Path("historico_apostas.csv")
DELAY_SEGUNDOS = 180
REQUEST_TIMEOUT = 30
FP_CHUNK_URL = "https://grupofpsinais.bet/_next/static/chunks/338-d4c371ad1ff8b3e6.js"
FP_IMAGE_MAP: dict[int, str] | None = None
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
)


@dataclass(frozen=True)
class Jogo:
    site: str
    nome: str
    aposta_minima: float
    aposta_padrao: float | None = None
    aposta_maxima: float | None = None
    distribuicao: float | None = None
    imagem_url: str | None = None
    atualizado_em: str | None = None


@dataclass(frozen=True)
class SiteConfig:
    nome: str
    url: str
    parser: Callable[[str, "SiteConfig"], list[Jogo]]
    selenium_wait_selector: str


def parse_float(texto: str | None) -> float | None:
    if not texto:
        return None
    match = re.search(r"\d+(?:[.,]\d+)?", texto)
    if not match:
        return None
    return float(match.group(0).replace(",", "."))


def normalizar_texto(texto: str) -> str:
    return re.sub(r"\s+", " ", texto).strip()


def limpar_nome(texto: str | None) -> str | None:
    if not texto:
        return None
    texto = html.unescape(texto)
    texto = normalizar_texto(texto)
    return texto or None


def baixar_html(url: str) -> str:
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9"},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    return response.text


def extrair_rainha_do_slot(page_html: str, site: SiteConfig) -> list[Jogo]:
    soup = BeautifulSoup(page_html, "html.parser")
    jogos: list[Jogo] = []

    for titulo in soup.select("h3[data-name], h3.game-title, h3"):
        nome = limpar_nome(titulo.get("data-name") or titulo.get_text(" ", strip=True))
        if not nome:
            continue

        card = titulo
        for _ in range(6):
            if not card.parent:
                break
            card = card.parent
            texto_card = normalizar_texto(card.get_text(" ", strip=True))
            if "Aposta Minima" in texto_card or "Aposta Mínima" in texto_card:
                break
        else:
            continue

        texto_card = normalizar_texto(card.get_text(" ", strip=True))
        minima = parse_float(_buscar_rotulo(texto_card, "Aposta Mínima", "Aposta Minima"))
        if minima is None:
            continue
        img = card.select_one("img")
        imagem_url = None
        if img:
            imagem_url = img.get("src") or img.get("data-src")
            if imagem_url:
                imagem_url = urljoin(site.url, imagem_url)

        jogos.append(
            Jogo(
                site=site.nome,
                nome=nome,
                aposta_minima=minima,
                aposta_padrao=parse_float(_buscar_rotulo(texto_card, "Aposta Padrão", "Aposta Padrao")),
                aposta_maxima=parse_float(_buscar_rotulo(texto_card, "Aposta Máxima", "Aposta Maxima")),
                distribuicao=parse_float(_buscar_rotulo(texto_card, "Distribuição", "Distribuicao")),
                imagem_url=imagem_url,
            )
        )

    return _remover_duplicados(jogos)


def extrair_grupo_fp(page_html: str, site: SiteConfig) -> list[Jogo]:
    jogos: list[Jogo] = []
    imagens = obter_mapa_imagens_fp()
    padrao = re.compile(
        r'\\?"id\\?":(?P<id>\d+)'
        r".{0,300}?"
        r'\\?"nomeJogo\\?":\\?"(?P<nome>.*?)(?<!\\)\\?"'
        r".{0,600}?"
        r'\\?"porcentagem\\?":(?P<porcentagem>\d+)'
        r".{0,300}?"
        r'\\?"minima\\?":(?P<minima>\d+)'
        r".{0,300}?"
        r'\\?"padrao\\?":(?P<padrao>\d+)'
        r".{0,300}?"
        r'\\?"maxima\\?":(?P<maxima>\d+)',
        re.DOTALL,
    )

    for match in padrao.finditer(page_html):
        jogo_id = int(match.group("id"))
        nome_raw = match.group("nome").replace(r"\/", "/")
        try:
            nome = json.loads(f'"{nome_raw}"')
        except json.JSONDecodeError:
            nome = nome_raw.replace(r"\"", '"')
        nome = limpar_nome(nome)
        if not nome:
            continue

        jogos.append(
            Jogo(
                site=site.nome,
                nome=nome,
                aposta_minima=float(match.group("minima")),
                aposta_padrao=float(match.group("padrao")),
                aposta_maxima=float(match.group("maxima")),
                distribuicao=float(match.group("porcentagem")),
                imagem_url=imagens.get(jogo_id),
            )
        )

    return _remover_duplicados(jogos)


def extrair_programticplay(page_html: str, site: SiteConfig) -> list[Jogo]:
    """Parser genérico para ProgramticPlay — heurística baseada em títulos e percentuais.
    Ajuste seletores se o site tiver estrutura específica.
    """
    soup = BeautifulSoup(page_html, "html.parser")
    jogos: list[Jogo] = []

    # Tenta encontrar títulos comuns de jogos
    candidatos = soup.select("h3, h2, h4, .game-title, .title, .slot-title")

    if not candidatos:
        # fallback: procurar por blocos que contenham porcentagem
        candidatos = soup.find_all(lambda tag: tag.name in ("div", "article") and "%" in tag.get_text())

    for titulo in candidatos:
        nome = limpar_nome(titulo.get_text(" ", strip=True))
        if not nome:
            continue

        # sobe até alguns níveis para encontrar contexto com números
        bloco = titulo
        for _ in range(6):
            if not bloco.parent:
                break
            bloco = bloco.parent
            texto = normalizar_texto(bloco.get_text(" ", strip=True))
            # procura por um número com % próximo
            porcentagem = re.search(r"(\d{1,3}(?:[.,]\d+)?)\s*%", texto)
            if porcentagem or "Aposta Minima" in texto or "Aposta Mínima" in texto:
                break

        texto = normalizar_texto(bloco.get_text(" ", strip=True))
        minima = parse_float(_buscar_rotulo(texto, "Aposta Mínima", "Aposta Minima"))
        if minima is None:
            # tenta extrair o primeiro percentual encontrado
            m = re.search(r"(\d{1,3}(?:[.,]\d+)?)\s*%", texto)
            minima = float(m.group(1).replace(",", ".")) if m else None

        if minima is None:
            continue

        img = bloco.select_one("img")
        imagem_url = None
        if img:
            imagem_url = img.get("src") or img.get("data-src")
            if imagem_url:
                imagem_url = urljoin(site.url, imagem_url)

        jogos.append(
            Jogo(
                site=site.nome,
                nome=nome,
                aposta_minima=minima,
                imagem_url=imagem_url,
            )
        )

    return _remover_duplicados(jogos)


def _buscar_rotulo(texto: str, *rotulos: str) -> str | None:
    for rotulo in rotulos:
        match = re.search(rf"{re.escape(rotulo)}\s*:?\s*(\d+(?:[.,]\d+)?)\s*%?", texto, re.I)
        if match:
            return match.group(1)
    return None


def _remover_duplicados(jogos: list[Jogo]) -> list[Jogo]:
    vistos: set[tuple[str, str]] = set()
    unicos: list[Jogo] = []
    for jogo in jogos:
        chave = (jogo.site, jogo.nome.casefold())
        if chave not in vistos:
            vistos.add(chave)
            unicos.append(jogo)
    return unicos


def obter_mapa_imagens_fp() -> dict[int, str]:
    global FP_IMAGE_MAP
    if FP_IMAGE_MAP is not None:
        return FP_IMAGE_MAP

    try:
        js = baixar_html(FP_CHUNK_URL)
    except Exception:
        FP_IMAGE_MAP = {}
        return FP_IMAGE_MAP

    imagens: dict[int, str] = {}
    for jogo_id, image_url, _icon_url in re.findall(r'(\d+):\{image:"([^"]+)",icon:"([^"]+)"\}', js):
        imagens[int(jogo_id)] = urljoin("https://grupofpsinais.bet", image_url)

    FP_IMAGE_MAP = imagens
    return FP_IMAGE_MAP


SITES = [
    SiteConfig(
        nome="Rainha do Slot",
        url="https://rainhadoslot.com.br",
        parser=extrair_rainha_do_slot,
        selenium_wait_selector="h3[data-name], .gamePercentage",
    ),
    SiteConfig(
        nome="Grupo FP Sinais",
        url="https://grupofpsinais.bet",
        parser=extrair_grupo_fp,
        selenium_wait_selector="body",
    ),
    SiteConfig(
        nome="ProgramticPlay",
        url="https://programticplay.com",
        parser=extrair_programticplay,
        selenium_wait_selector="body",
    ),
]


def iniciar_driver() -> webdriver.Chrome:
    if not SELENIUM_AVAILABLE:
        raise RuntimeError("Instale as dependencias com: pip install -r requirements.txt")

    chrome_options = Options()
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_argument(f"--user-agent={USER_AGENT}")
    service = Service(ChromeDriverManager().install())
    return webdriver.Chrome(service=service, options=chrome_options)


def coletar_site(site: SiteConfig, usar_selenium: bool, driver: webdriver.Chrome | None) -> list[Jogo]:
    try:
        page_html = baixar_html(site.url)
        jogos = site.parser(page_html, site)
        if jogos:
            return jogos
        print(f"{site.nome}: requests nao encontrou jogos; tentando Selenium.")
    except Exception as exc:
        print(f"{site.nome}: falha com requests: {exc}.")

    if not usar_selenium or driver is None:
        return []

    try:
        driver.get(site.url)
        WebDriverWait(driver, 30).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, site.selenium_wait_selector))
        )
        time.sleep(2)
        return site.parser(driver.page_source, site)
    except Exception as exc:
        print(f"{site.nome}: falha com Selenium: {exc}")
        return []


def salvar_csv(jogos: list[Jogo]) -> None:
    novo_arquivo = not CSV_FILE.exists()
    with CSV_FILE.open("a", newline="", encoding="utf-8") as arquivo:
        writer = csv.writer(arquivo)
        if novo_arquivo:
            writer.writerow(
                [
                    "timestamp",
                    "site",
                    "jogo",
                    "aposta_minima",
                    "aposta_padrao",
                    "aposta_maxima",
                    "distribuicao",
                ]
            )
        timestamp = datetime.now().isoformat(timespec="seconds")
        for jogo in jogos:
            writer.writerow(
                [
                    timestamp,
                    jogo.site,
                    jogo.nome,
                    jogo.aposta_minima,
                    jogo.aposta_padrao,
                    jogo.aposta_maxima,
                    jogo.distribuicao,
                ]
            )


def melhor_jogo(jogos: list[Jogo]) -> Jogo | None:
    return min(jogos, key=pontuacao_distancia_100, default=None)


def pontuacao_distancia_100(jogo: Jogo) -> float:
    distribuicao = jogo.distribuicao if jogo.distribuicao is not None else 0
    return abs(100 - jogo.aposta_minima) + abs(100 - distribuicao)


def media_proximidade_100(jogo: Jogo) -> float:
    distribuicao = jogo.distribuicao if jogo.distribuicao is not None else 0
    return (jogo.aposta_minima + distribuicao) / 2


def melhores_jogos(jogos: list[Jogo], limite: int = 5) -> list[Jogo]:
    return sorted(jogos, key=pontuacao_distancia_100)[:limite]


def executar_rodada(usar_selenium: bool, driver: webdriver.Chrome | None) -> list[Jogo]:
    todos_jogos: list[Jogo] = []
    for site in SITES:
        jogos = coletar_site(site, usar_selenium, driver)
        print(f"{site.nome}: {len(jogos)} jogos encontrados.")
        todos_jogos.extend(jogos)
    if todos_jogos:
        salvar_csv(todos_jogos)
    return todos_jogos


def main() -> None:
    parser = argparse.ArgumentParser(description="Monitor de sinais de slots.")
    parser.add_argument("--once", action="store_true", help="Executa uma rodada e encerra.")
    parser.add_argument("--selenium", action="store_true", help="Usa Selenium como fallback.")
    parser.add_argument("--intervalo", type=int, default=DELAY_SEGUNDOS, help="Intervalo em segundos.")
    args = parser.parse_args()

    driver = iniciar_driver() if args.selenium else None
    print("Monitor iniciado. Conteudo para maiores de 18 anos; jogue com responsabilidade.")

    try:
        while True:
            jogos = executar_rodada(args.selenium, driver)
            melhor = melhor_jogo(jogos)
            agora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            if melhor:
                distribuicao = melhor.distribuicao if melhor.distribuicao is not None else 0
                print(
                    f"[{agora}] Melhor jogo: {melhor.nome} ({melhor.site}) "
                    f"com aposta minima {melhor.aposta_minima:.0f}% e "
                    f"distribuicao {distribuicao:.0f}% "
                    f"(media {media_proximidade_100(melhor):.1f}%)"
                )
                print("Top 5 por aposta minima + distribuicao mais proximas de 100%:")
                for posicao, jogo in enumerate(melhores_jogos(jogos), start=1):
                    dist = jogo.distribuicao if jogo.distribuicao is not None else 0
                    print(
                        f"  {posicao}. {jogo.nome} ({jogo.site}) - "
                        f"minima {jogo.aposta_minima:.0f}%, distribuicao {dist:.0f}%, "
                        f"media {media_proximidade_100(jogo):.1f}%"
                    )
            else:
                print(f"[{agora}] Nenhum jogo encontrado nesta rodada.")

            if args.once:
                break
            time.sleep(args.intervalo)
    finally:
        if driver:
            driver.quit()


if __name__ == "__main__":
    main()
