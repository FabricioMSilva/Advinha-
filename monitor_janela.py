import argparse
import threading
import tkinter as tk
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from tkinter import ttk

import requests
from PIL import Image, ImageTk

from monitor_apostas import (
    Jogo,
    SITES,
    coletar_site,
    iniciar_driver,
    media_proximidade_100,
    melhor_jogo,
    melhores_jogos,
    salvar_csv,
)


INTERVALO_PADRAO_SEGUNDOS = 120


class MonitorJanela(tk.Tk):
    def __init__(self, intervalo_segundos: int, usar_selenium: bool = False) -> None:
        super().__init__()
        self.intervalo_ms = intervalo_segundos * 1000
        self.usar_selenium = usar_selenium
        self.driver = iniciar_driver() if usar_selenium else None
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.carregando = False
        self.proxima_atualizacao: datetime | None = None
        self.imagens_cache: dict[str, ImageTk.PhotoImage] = {}

        self.title("Monitor de Jogos - Aposta Minima e Distribuicao")
        self.geometry("1120x720")
        self.minsize(920, 620)
        self.configure(bg="#10131a")

        self._criar_estilos()
        self._criar_layout()
        self.protocol("WM_DELETE_WINDOW", self._fechar)

        self._atualizar_agora()
        self._tick_relogio()

    def _criar_estilos(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TFrame", background="#10131a")
        style.configure("Panel.TFrame", background="#171b24")
        style.configure("TLabel", background="#10131a", foreground="#f6f7fb")
        style.configure("Muted.TLabel", background="#10131a", foreground="#aab1c2")
        style.configure("Panel.TLabel", background="#171b24", foreground="#f6f7fb")
        style.configure("Title.TLabel", font=("Segoe UI", 18, "bold"))
        style.configure("Best.TLabel", font=("Segoe UI", 15, "bold"), foreground="#67e089")
        style.configure("TButton", font=("Segoe UI", 10, "bold"))
        style.configure(
            "Treeview",
            background="#0f1218",
            fieldbackground="#0f1218",
            foreground="#f6f7fb",
            rowheight=58,
            borderwidth=0,
            font=("Segoe UI", 10),
        )
        style.configure(
            "Treeview.Heading",
            background="#242a36",
            foreground="#f6f7fb",
            font=("Segoe UI", 10, "bold"),
        )
        style.map("Treeview", background=[("selected", "#2f6fed")])

    def _criar_layout(self) -> None:
        header = ttk.Frame(self, padding=(18, 16, 18, 10))
        header.pack(fill="x")

        titulo = ttk.Label(header, text="Monitor de Melhores Jogos", style="Title.TLabel")
        titulo.pack(anchor="w")

        self.status_var = tk.StringVar(value="Preparando primeira atualizacao...")
        ttk.Label(header, textvariable=self.status_var, style="Muted.TLabel").pack(anchor="w", pady=(4, 0))

        best_panel = ttk.Frame(self, style="Panel.TFrame", padding=16)
        best_panel.pack(fill="x", padx=18, pady=(4, 14))

        self.melhor_var = tk.StringVar(value="Coletando dados...")
        ttk.Label(best_panel, text="Melhor geral agora", style="Panel.TLabel").pack(anchor="w")
        ttk.Label(best_panel, textvariable=self.melhor_var, style="Best.TLabel").pack(anchor="w", pady=(6, 0))

        actions = ttk.Frame(best_panel, style="Panel.TFrame")
        actions.pack(anchor="e", fill="x", pady=(10, 0))
        ttk.Button(actions, text="Atualizar agora", command=self._atualizar_agora).pack(side="right")

        tabelas = ttk.Frame(self, padding=(18, 0, 18, 18))
        tabelas.pack(fill="both", expand=True)
        tabelas.columnconfigure(0, weight=1)
        tabelas.columnconfigure(1, weight=1)
        tabelas.rowconfigure(1, weight=1)

        self.arvores: dict[str, ttk.Treeview] = {}
        for coluna, site in enumerate(SITES):
            ttk.Label(tabelas, text=f"Top 10 - {site.nome}", style="Title.TLabel").grid(
                row=0, column=coluna, sticky="w", padx=(0 if coluna == 0 else 10, 0), pady=(0, 8)
            )
            frame = ttk.Frame(tabelas, style="Panel.TFrame", padding=10)
            frame.grid(row=1, column=coluna, sticky="nsew", padx=(0 if coluna == 0 else 10, 0))

            tree = ttk.Treeview(
                frame,
                columns=("pos", "jogo", "minima", "distribuicao", "media"),
                show="tree headings",
                height=14,
            )
            tree.heading("#0", text="Img")
            tree.heading("pos", text="#")
            tree.heading("jogo", text="Jogo")
            tree.heading("minima", text="Minima")
            tree.heading("distribuicao", text="Distrib.")
            tree.heading("media", text="Media")
            tree.column("#0", width=62, anchor="center", stretch=False)
            tree.column("pos", width=44, anchor="center", stretch=False)
            tree.column("jogo", width=220, anchor="w")
            tree.column("minima", width=78, anchor="center", stretch=False)
            tree.column("distribuicao", width=78, anchor="center", stretch=False)
            tree.column("media", width=78, anchor="center", stretch=False)
            tree.pack(fill="both", expand=True)
            self.arvores[site.nome] = tree

    def _atualizar_agora(self) -> None:
        if self.carregando:
            return
        self.carregando = True
        self.status_var.set("Atualizando dados dos dois sites...")
        futuro = self.executor.submit(self._coletar_todos)
        threading.Thread(target=self._aguardar_resultado, args=(futuro,), daemon=True).start()

    def _coletar_todos(self) -> list[Jogo]:
        todos: list[Jogo] = []
        for site in SITES:
            todos.extend(coletar_site(site, self.usar_selenium, self.driver))
        if todos:
            salvar_csv(todos)
        return todos

    def _aguardar_resultado(self, futuro) -> None:
        try:
            jogos = futuro.result()
            self.after(0, lambda: self._mostrar_resultado(jogos, None))
        except Exception as exc:
            self.after(0, lambda: self._mostrar_resultado([], exc))

    def _mostrar_resultado(self, jogos: list[Jogo], erro: Exception | None) -> None:
        self.carregando = False
        agora = datetime.now()
        self.proxima_atualizacao = agora.fromtimestamp((agora.timestamp() * 1000 + self.intervalo_ms) / 1000)

        if erro:
            self.status_var.set(f"Erro ao atualizar: {erro}")
            self.after(self.intervalo_ms, self._atualizar_agora)
            return

        melhor = melhor_jogo(jogos)
        if melhor:
            dist = melhor.distribuicao if melhor.distribuicao is not None else 0
            self.melhor_var.set(
                f"{melhor.nome} ({melhor.site}) - minima {melhor.aposta_minima:.0f}% | "
                f"distribuicao {dist:.0f}% | media {media_proximidade_100(melhor):.1f}%"
            )
        else:
            self.melhor_var.set("Nenhum jogo encontrado nesta rodada.")

        for site in SITES:
            jogos_site = [jogo for jogo in jogos if jogo.site == site.nome]
            self._preencher_tabela(site.nome, melhores_jogos(jogos_site, limite=10))

        total = len(jogos)
        self.status_var.set(
            f"Ultima atualizacao: {agora:%H:%M:%S} | {total} jogos analisados | proxima em 2 minutos"
        )
        self.after(self.intervalo_ms, self._atualizar_agora)

    def _preencher_tabela(self, site_nome: str, jogos: list[Jogo]) -> None:
        tree = self.arvores[site_nome]
        tree.delete(*tree.get_children())
        for posicao, jogo in enumerate(jogos, start=1):
            dist = jogo.distribuicao if jogo.distribuicao is not None else 0
            imagem = self._obter_imagem(jogo.imagem_url)
            tree.insert(
                "",
                "end",
                image=imagem,
                values=(
                    posicao,
                    jogo.nome,
                    f"{jogo.aposta_minima:.0f}%",
                    f"{dist:.0f}%",
                    f"{media_proximidade_100(jogo):.1f}%",
                ),
            )

    def _obter_imagem(self, url: str | None) -> ImageTk.PhotoImage | None:
        if not url:
            return None
        if url in self.imagens_cache:
            return self.imagens_cache[url]

        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            imagem = Image.open(BytesIO(response.content)).convert("RGBA")
            imagem.thumbnail((52, 52), Image.Resampling.LANCZOS)
            foto = ImageTk.PhotoImage(imagem)
        except Exception:
            return None

        self.imagens_cache[url] = foto
        return foto

    def _tick_relogio(self) -> None:
        if self.proxima_atualizacao and not self.carregando:
            restante = max(0, int((self.proxima_atualizacao - datetime.now()).total_seconds()))
            minutos, segundos = divmod(restante, 60)
            texto_base = self.status_var.get().split("| proxima")[0].strip()
            self.status_var.set(f"{texto_base} | proxima em {minutos:02d}:{segundos:02d}")
        self.after(1000, self._tick_relogio)

    def _fechar(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=True)
        if self.driver:
            self.driver.quit()
        self.destroy()


def main() -> None:
    parser = argparse.ArgumentParser(description="Janela do monitor de jogos.")
    parser.add_argument("--intervalo", type=int, default=INTERVALO_PADRAO_SEGUNDOS, help="Intervalo em segundos.")
    parser.add_argument("--selenium", action="store_true", help="Usa Selenium como fallback.")
    args = parser.parse_args()

    app = MonitorJanela(intervalo_segundos=args.intervalo, usar_selenium=args.selenium)
    app.mainloop()


if __name__ == "__main__":
    main()
