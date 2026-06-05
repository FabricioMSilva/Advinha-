# FBR Sinais de Jogos

Site de monitoramento de apostas com interface responsiva, editor de cards de plataforma e login de administrador.

## O que tem aqui

- `public/index.html` - página principal do site
- `public/styles.css` - estilos e identidade visual
- `public/app.js` - lógica do editor de cards, login admin e renderização dos dados
- `netlify/functions/jogos.mjs` - função serverless para retorno de dados de jogos
- `package.json` / `package-lock.json` - dependências do projeto
- `requirements.txt` - dependências Python usadas pelo backend

## Como usar

1. Abra `public/index.html` no navegador para ver a interface estática.
2. Para editar os cards de parceiros, clique em `Login` e use a senha de administrador.
3. Os cards padrão também podem ser alterados em `public/platforms.json`.
4. O conteúdo do editor é salvo localmente no `localStorage` do navegador.

## Configuração local

Se quiser rodar localmente com Netlify ou outra ferramenta de desenvolvimento:

- Instale dependências Node.js com `npm install` se for usar algum comando local do Netlify.
- Se houver backend Python, instale os pacotes de `requirements.txt`.

## Observações

- O projeto já está versionado no Git e conectado ao GitHub.
- O `.gitignore` inclui pastas e arquivos locais como `.netlify/`, `node_modules/`, `*.log`, e `.venv/`.
