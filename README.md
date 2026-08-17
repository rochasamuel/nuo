# UNO — MVP multiplayer

Jogo de cartas multiplayer inspirado no UNO. O servidor é autoritativo: o cliente
apenas pede ações e desenha o estado que recebe de volta.

## Arquitetura

```
React (apps/web)
   │  @colyseus/sdk
   ▼
Colyseus (apps/server)
   │
   ├── UnoRoom     sala, conexões, reconexão, estado sincronizado
   │
   └── UnoGame     baralho, regras, turnos, vitória
```

O estado oficial da partida vive **em memória no servidor**. Não há banco de
dados: reiniciar o processo perde as partidas em andamento, e isso é aceitável
neste MVP. O game engine (`UnoGame`) não conhece Colyseus, então trocar o
transporte ou persistir o estado depois não obriga a reescrevê-lo.

### O que o cliente recebe

`UnoRoomState` carrega só informação pública: jogadores, quantidade de cartas de
cada um, jogador da vez, cor em jogo, direção, topo do descarte e mensagens de
sistema. **A mão de um jogador nunca entra no estado sincronizado** — ela vai
numa mensagem `hand` endereçada só ao dono, junto da lista de cartas que ele pode
jogar agora. Quem decide o que é jogável é o servidor; a UI apenas obedece.

Fora do estado sincronizado ficam também os **instantes**: os eventos `fx`, que
as animações usam, e a conversa da mesa (`emote`), um emoji de uma lista fechada
que aparece por três segundos abaixo de quem falou. Nenhum dos dois é situação —
guardá-los no estado os faria ressuscitar na tela de quem entrasse depois.

## Requisitos

- Node.js >= 20.9
- pnpm (`corepack enable pnpm`)

## Instalação

```bash
pnpm install
```

## Desenvolvimento

```bash
pnpm dev          # tipos compartilhados + servidor (2567) + web (5173)
pnpm dev:web
pnpm dev:server
```

Abra <http://localhost:5173>.

## Build e testes

```bash
pnpm build        # valida o projeto inteiro
pnpm build:web
pnpm build:server
pnpm test         # regras do UNO
pnpm lint
```

Em produção o servidor roda com `pnpm --filter server start` (a partir de
`apps/server/build`). O endpoint usado pelo front sai de `VITE_SERVER_URL`, com
`http://<host>:2567` como padrão.

`@uno/shared` é compilado (os apps importam `dist/`, não `src/`), e `dist/` não
vai para o git. Por isso o `build` de cada app compila o pacote compartilhado
antes de compilar a si mesmo: num container recém-clonado, `pnpm --filter server
build` sozinho não teria os tipos e falharia com `Cannot find module
'@uno/shared'`. Compilar duas vezes custa um segundo; descobrir isso no deploy
custa mais.

## Estrutura

```
apps/
  server/
    src/game/       UnoGame, deck, rules  ← as regras moram aqui
    src/rooms/      UnoRoom, UnoState
  web/
    public/cards/   as 55 artes SVG do baralho
    public/demo.html  a demo de referência das cartas (usa os mesmos assets)
    src/components/ mesa, mão, pilhas
    src/game/       conexão com a sala
packages/
  shared/           tipos de carta, constantes e o formato do estado público
tools/
  cards/            gerador dos SVGs (Python) + uno_card.md
```

`tools/cards/uno_card.md` é a fonte de verdade do visual e das animações das
cartas, e `public/demo.html` é a demo que valida aquele documento. Se for mexer
em sombra, leque, arraste ou nas pilhas, leia os dois antes.

Para regerar as artes: `python3 tools/cards/gen_card.py` (escreve em
`apps/web/public/cards/svg/`).

## Design

A interface é pixel art porque as cartas são. Os tokens em `src/index.css` não
são escolhidos a olho: são as rampas de cor de `tools/cards/gen_card.py`. Os
painéis usam o material do **verso** da carta (`COLORWAYS["wild"]`), o texto usa
o material da **moldura** (`FRM`), e a única cor de ênfase é o amarelo da
palavra "UNO" do verso (`MARK`).

Quatro regras, todas herdadas do desenho das cartas:

- nada de blur, de `border-radius` ou de gradiente suave;
- tudo na grade de 4px, com traço de 2px (o chanfro da carta é 4px, o traço 2px);
- relevo de três partes — claro em cima/à esquerda, escuro embaixo/à direita —
  que é a mesma estrutura que dá volume aos dígitos das cartas;
- sombra dura deslocada, nunca difusa; botão apertado afunda exatamente a
  altura da própria sombra.

O movimento segue a mesma divisão: as **cartas** se movem como objetos físicos,
com as curvas validadas no `uno_card.md`; a **interface** pisca em quadros
(`steps()`), como um jogo de 32 bits.

O logotipo do jogo é a própria carta: o verso já traz a palavra na tipografia do
baralho, inclinada nos mesmos 25° do oval.

### O seletor de cor do coringa

`uno-wild-change.svg` não tem símbolo central — o símbolo é o oval da própria
carta, dividido em quatro pelos eixos **do oval**, não os da tela. O seletor é
esse oval ampliado e clicável: mesma elipse (`rx 8,6 / ry 15,5`), mesma
inclinação de 25°, mesmas cores (`SUIT_INK`) e mesma ordem de leitura
(vermelho, azul, amarelo, verde). Você escolhe a cor tocando o quadrante dela.
O fundo é o painel, que já é o material do verso da carta, então o oval assenta
sobre a mesma cor de corpo que tem na carta impressa.

Abaixo do oval há um atalho para **manter a cor que já está valendo**, com o
nome dela. Para desistir da jogada, clique fora ou aperte `Esc`.

A geometria foi conferida contra o gerador pixel a pixel: os 416 pixels do oval
saem idênticos aos da carta impressa.

### Mesa de mentira para acertar o layout

`/mock` monta a mesma `Table` com estado inventado e um painel de controles:
número de cartas na mão (1–30), de jogadores (2–10), coringa no topo, compra
pendente, fim de partida. Serve para ver os extremos sem subir servidor nem
juntar gente. Não toca em nada do jogo — é só outra rota.

### A mão nunca passa da janela

O leque cabe por dois meios, nesta ordem: as cartas se sobrepõem mais (dos 55%
da demo até 84%, limite em que ainda sobra faixa para clicar) e, só quando isso
se esgota, encolhem. A abertura do leque também trava em 36° no total, senão as
cartas das pontas giram para fora da tela. Com uma mão comum no desktop nada
disso entra em ação: carta de 120px e 55% de recobrimento, exatamente os valores
da demo.

## Como jogar

1. Na home, informe o nome da sala e o seu nome e crie a sala.
2. Copie o link (`/room/CÓDIGO`) e mande para os outros.
3. Quem abrir o link informa um nome e entra. Não há login.
4. Com 2 jogadores ou mais, o host inicia a partida.
5. Clique numa carta para selecioná-la e clique de novo para jogar, ou arraste-a
   até o descarte. Os dois caminhos disparam a mesma ação.

### Reconexão

Ao entrar, o cliente guarda em `localStorage` apenas o `reconnectionToken` e o
nome do jogador. Ao reabrir o link, ele chama `client.reconnect(token)` e volta
para a mesma cadeira, com a mesma mão. O servidor segura o lugar por 60 segundos
(`RECONNECT_TIMEOUT`). Passado esse tempo, ou se o token não valer mais, a tela
explica que não foi possível voltar e oferece entrar de novo.

## Regras implementadas

Somente o jogo base, sem house rules: números, Skip, Reverse, +2, coringa,
coringa +4, troca de cor, compra, validação de jogada, turno, direção, vitória,
chamada de UNO e penalidade por esquecê-la.

Onde a regra oficial admite mais de uma leitura, a escolha foi esta:

- **Primeira carta coringa** — volta para o fundo do baralho e vira-se outra, em
  vez de deixar o primeiro jogador escolher a cor.
- **Primeira carta de ação** — Skip pula o primeiro jogador; Reverse inverte a
  direção (e o primeiro a jogar passa a ser o último da ordem); +2 obriga o
  primeiro jogador a comprar 2 e perder a vez.
- **Compra** — comprar é a saída para quem **não tem jogada**, não uma
  alternativa a jogar: com carta jogável na mão o servidor recusa a compra e o
  monte aparece desabilitado. Sem jogada, comprar é a única ação possível. Se a
  carta comprada for jogável, pode-se jogá-la na hora (e só ela) ou passar; se
  não for, o turno passa sozinho, sem exigir nada do jogador.
- **+2 e +4** — não empilham. A carta marca `pendingDraw` para o próximo jogador,
  que só pode comprar e perde a vez. É esse mesmo campo que uma regra de
  empilhamento usaria depois.
- **+4** — pode ser jogado a qualquer momento. Não há desafio ao +4.
- **UNO** — só se grita **depois** de baixar a penúltima carta, nunca antes:
  deixar gritar com duas na mão daria imunidade de graça e a penalidade nunca
  chegaria a acontecer. Quem fica com uma carta sem ter gritado está exposto, e
  qualquer outro jogador pode pegá-lo — ele compra 2.

  A exposição abre quando a penúltima carta cai no descarte e fecha na próxima
  jogada ou compra de qualquer um. Dentro dela há uma **carência de 2,5s
  (`UNO_GRACE`) em que só o exposto pode agir**: o `catchUno` é recusado até ela
  passar. Sem isso a corrida seria decidida pela posição do cursor — o botão
  "Pegar" nasce num lugar fixo, então bastava deixar o dedo em cima e clicar em
  rajada para vencer sempre, enquanto quem tem que gritar ainda precisa perceber
  e mirar. A carência dá esse tempo só a quem esqueceu.

  O botão "Pegar" **só aparece quando já dá para clicar**. Mostrá-lo
  desabilitado durante a carência entregava o alvo — bastava parar o cursor ali
  e esperar. Escondido, aparecer é o próprio aviso.

  O relógio é injetado no `UnoGame` (como o `random`), então os testes controlam
  a passagem do tempo em vez de esperar por ela.
- **Dois jogadores** — Reverse funciona como Skip.

Não há pontuação: a partida termina quando alguém zera a mão.

## Onde mexer depois

- **Novas regras / modos**: `apps/server/src/game/`. `rules.ts` decide o que é
  jogável, `UnoGame.applyEffect` decide o que uma carta faz. Regras como 7-0,
  jump-in ou empilhamento de +2 entram nesses dois pontos, sem tocar na Room nem
  no front.
- **Novos campos visíveis para o cliente**: `apps/server/src/rooms/UnoState.ts` e
  o tipo `TableState` em `packages/shared`, que descreve o mesmo formato.
- **Som**: solte um `.mp3` em `apps/web/public/sounds/` com o nome do efeito
  (`draw`, `play`, `action`, `turn`, `uno`, `victory`) e o `useSound` passa a
  tocá-lo. Sem arquivo, ele fica em silêncio.
