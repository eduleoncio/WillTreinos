# Will Treinos

Protótipo responsivo para apoiar a organização das aulas gratuitas de vôlei do projeto social Will Treinos, no Ouro Verde, em Campinas/SP.

## Requisitos

- Node.js 20.19+ ou 22.12+
- npm

## Começar no VS Code

Abra a pasta do projeto no VS Code e, no terminal integrado, execute:

```bash
npm install
npm run dev
```

O Vite mostrará um endereço local — normalmente `http://localhost:5173`. Abra esse endereço no navegador. Para parar o servidor, pressione `Ctrl+C` no terminal.

## Comandos

```bash
npm run dev      # inicia o servidor de desenvolvimento
npm run build    # gera a versão de produção na pasta dist/
npm run preview  # abre localmente a versão gerada em dist/
```

## Estrutura

```text
index.html       entrada da aplicação
src/main.js      interações e navegação
src/style.css    estilos e layout responsivo
dist/            saída gerada pelo build (não enviar ao Git)
```

O protótipo usa HTML, CSS, JavaScript e Vite. Não precisa instalar extensões do VS Code. Os novos alunos de demonstração são salvos apenas no `localStorage` do navegador.

## Conteúdo demonstrativo

Os nomes, horários, contagens, frequência e eventos são exemplos para apresentar a interface, não dados reais do projeto. Login por CPF, QR Code, mensagens em tempo real, notificações e banco de dados compartilhado ainda não estão conectados.
