# UNO Multiplayer MVP — Claude Code

Você é um **senior full-stack game developer**, com foco em código simples, legível, performático e pragmático.

Quero que você construa o MVP de um jogo de cartas multiplayer inspirado no UNO.

O objetivo é **lançar rapidamente uma primeira versão jogável**, portanto NÃO faça overengineering, NÃO crie abstrações desnecessárias e NÃO implemente funcionalidades que não foram solicitadas.

A regra principal de desenvolvimento é:

> **Use o mínimo de código necessário para produzir uma arquitetura limpa, extensível e fácil de entender.**

O código deve ser suficientemente claro para que um desenvolvedor consiga entendê-lo sem precisar de comentários explicando o óbvio.

---

# 1. Antes de escrever código

Primeiro, inspecione completamente o projeto atual.

Procure especialmente na raiz por:

- arquivos `.md` relacionados às cartas, regras ou animações;
- uma demo HTML existente;
- assets/imagens das cartas;
- qualquer documentação já existente;
- configurações ou código previamente criado.

A **demo HTML e o ********`.md`******** de instruções de cartas/animações são fontes de verdade para o visual e comportamento das cartas**.

Não substitua, simplifique ou reinvente o design definido nesses arquivos.

Se houver conflito entre uma interpretação sua e a demo/documentação existente, prefira a documentação/demonstração.

Também organize os assets da demo de forma que eles façam sentido dentro do futuro projeto web, evitando manter uma estrutura artificial apenas para reproduzir a demo.

Antes de implementar, faça uma análise rápida da estrutura encontrada e então prossiga diretamente para a implementação.

Não fique apenas descrevendo o que pretende fazer.

---

# 2. Stack

Use:

## Frontend

- React na versão mais recente disponível
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- Tanstack Query

Não adicionar neste momento:

- Next.js
- TanStack Start
- Redux
- Material UI
- Chakra
- outras bibliotecas de UI
- bibliotecas de state management adicionais

Use CSS/Tailwind e componentes React simples.

## Backend

- Node.js
- TypeScript
- Colyseus

Use o setup oficial recomendado pelo Colyseus para criar o servidor.

Se a documentação oficial do Colyseus recomendar um comando `npm create` ou equivalente para iniciar o projeto, use esse setup em vez de criar manualmente uma estrutura incompatível.

O backend multiplayer deve ser um servidor Colyseus independente do frontend.

---

# 3. Monorepo

Crie um monorepo simples.

Uma estrutura aproximada:

```text
/
├── apps/
│   ├── web/
│   └── server/
│
├── packages/
│   └── shared/
│
├── demo/
│   ...
│
├── package.json
└── ...
```

Não crie dezenas de packages.

O objetivo é separar:

- aplicação web;
- servidor multiplayer;
- tipos/constantes realmente compartilhados.

Use o gerenciador de pacotes pnpm.

Mantenha scripts na raiz para executar frontend e servidor facilmente em desenvolvimento.

Exemplo conceitual:

```bash
npm run dev
```

deve permitir iniciar o ambiente de desenvolvimento de maneira simples.

---

# 4. Arquitetura

A arquitetura deve ser:

```text
React
   │
   │ Colyseus Client
   │
   ▼
Colyseus Server
   │
   ├── UnoRoom
   │
   └── UnoGame
```

O servidor é **authoritative**.

O cliente nunca deve decidir se uma jogada é válida.

O cliente apenas solicita ações.

Exemplo:

```text
Client
  ↓
playCard(cardId)
  ↓
Colyseus
  ↓
UnoGame
  ↓
validate move
  ↓
update state
  ↓
broadcast state
```

A lógica crítica do jogo deve estar no servidor.

---

# 5. Banco de dados

NÃO usar banco de dados neste MVP.

Nenhum:

- PostgreSQL
- Supabase
- MongoDB
- Redis

Tudo deve existir em memória no servidor.

Isso inclui:

- salas;
- jogadores;
- estado das partidas;
- regras da partida;
- baralho;
- mãos;
- turno;
- pontuação/resultado da partida.

Quando o processo do servidor reiniciar, as partidas podem ser perdidas.

Isso é aceitável neste MVP.

Estruture o código de maneira que um banco possa ser adicionado futuramente sem precisar reescrever o game engine.

---

# 6. Sistema de salas

O usuário deve conseguir:

1. Criar uma sala.
2. Informar um nome para a sala.
3. Receber um código único.
4. Receber/copiar um link de convite.
5. Compartilhar esse link.
6. Outro jogador abrir o link.
7. Informar um nome temporário.
8. Entrar na sala.

Exemplo:

```text
Sala: Sexta-feira UNO
Código: A7K92
Link:
https://app.example.com/room/A7K92
```

Não implementar autenticação neste momento.

Os jogadores usam apenas um nome temporário.

---

# 7. Reconexão / refresh

Um jogador deve conseguir:

- atualizar a página;
- fechar acidentalmente a aba;
- abrir novamente o link da sala;

e retornar à partida quando possível.

Use `localStorage` para persistir o mínimo necessário para isso.

Por exemplo:

```text
roomId
playerSessionId / reconnection information
playerName
```

Não coloque o estado completo da partida no localStorage.

O estado oficial continua sendo o servidor.

Use os mecanismos de reconexão do Colyseus quando apropriado.

O comportamento desejado é:

```text
Player
  ↓
entra na sala
  ↓
fecha/refresh
  ↓
abre novamente
  ↓
cliente recupera identidade/reconnection data
  ↓
Colyseus reconecta
  ↓
jogador volta para a partida
```

Trate também o caso em que a reconexão não é mais possível e informe claramente o usuário.

---

# 8. UNO

A primeira versão deve implementar somente o **jogo base de UNO**, sem house rules.

Não implementar ainda:

- stacking de +2;
- stacking de +4;
- 7-0;
- jump-in;
- regras especiais customizadas;
- minigames;
- silêncio;
- qualquer outra regra que não faça parte do conjunto base definido para o MVP.

A arquitetura, entretanto, deve permitir adicionar essas regras posteriormente.

---

# 9. Jogadores

A sala deve suportar o número de jogadores permitido pelo jogo base.

Não hardcode uma arquitetura para exatamente quatro jogadores.

O sistema deve trabalhar com uma quantidade configurável de jogadores dentro do limite definido pelo jogo.

A sala deve saber:

```text
players
maxPlayers
host
gamePhase
currentPlayer
```

---

# 10. Game State

O estado sincronizado pelo Colyseus deve conter somente o que o cliente realmente precisa conhecer.

Exemplo conceitual:

```ts
gamePhase
players
currentPlayerId
topCard
currentColor
direction
drawCount
```

Tenha muito cuidado para **não enviar informações privadas dos jogadores**.

Um jogador não pode receber a mão dos outros jogadores.

O servidor deve manter as mãos completas internamente e expor somente:

```text
player.cardCount
```

para os outros jogadores.

O próprio jogador deve receber suas cartas.

---

# 11. Game Engine

Separe a lógica principal do jogo da implementação específica da Room do Colyseus.

Exemplo:

```text
UnoRoom
    ↓
UnoGame
    ↓
Deck
Rules
Turn handling
```

Não crie uma arquitetura exageradamente abstrata.

Não crie:

```text
AbstractGameFactory
GameRuleStrategyFactory
CardActionResolverFactory
EventBusFactory
```

ou equivalentes apenas para "seguir patterns".

Prefira código direto.

Exemplo aceitável:

```ts
game.playCard(playerId, cardId)
game.drawCard(playerId)
game.callUno(playerId)
game.nextTurn()
```

A implementação deve ser fácil de ler.

---

# 12. Cartas

Implemente o baralho do jogo base corretamente.

Modele claramente:

```ts
Card
Color
CardType
```

As cartas devem possuir identificadores únicos.

Exemplo conceitual:

```ts
type CardColor =
  | "red"
  | "yellow"
  | "green"
  | "blue"
  | "wild"

type CardType =
  | "number"
  | "skip"
  | "reverse"
  | "draw-two"
  | "wild"
  | "wild-draw-four"
```

Não faça o frontend inferir regras observando imagens.

A imagem é apenas uma representação visual da carta.

---

# 13. Regras

Implemente corretamente as regras base do UNO, incluindo todas as interações das cartas de ação.

Isso inclui pelo menos:

- cartas numéricas;
- Skip;
- Reverse;
- Draw Two;
- Wild;
- Wild Draw Four;
- mudança de cor;
- compra de cartas;
- validação de jogadas;
- turno;
- direção;
- condição de vitória;
- chamada de UNO;
- penalidade por não chamar UNO, quando aplicável;
- tratamento de cartas compradas;
- início correto da partida;
- comportamento da primeira carta;
- efeitos das cartas de ação;
- casos especiais de 2 jogadores.

Não invente regras de casa.

Caso uma regra oficial tenha múltiplas interpretações dependendo da edição do jogo, mantenha a implementação simples e consistente e registre a decisão em uma pequena seção da documentação do projeto.

---

# 14. Turn system

O jogo é baseado em turnos.

O servidor deve ser a única autoridade sobre:

```text
current player
direction
valid moves
draw
card effects
game phase
winner
```

O frontend deve apenas refletir o estado recebido.

Não confie em timers do cliente para determinar regras.

---

# 15. Segurança básica

Mesmo sendo um MVP, o cliente não pode trapacear simplesmente alterando seu JavaScript.

O servidor deve validar:

- se é o turno do jogador;
- se a carta pertence ao jogador;
- se a carta pode ser jogada;
- se a cor escolhida é válida;
- se o jogador pode comprar;
- se o jogador pode chamar UNO;
- qualquer outra ação relacionada ao estado da partida.

Nunca aceite do cliente:

```text
"Eu tenho essa carta"
"Essa carta é válida"
"É meu turno"
"Ganhei"
```

O servidor verifica tudo.

---

# 16. Frontend — telas

Crie inicialmente somente as telas necessárias.

## Tela 1 — Home / Create Room

Deve permitir:

```text
Nome da sala
Nome do jogador
Criar sala
```

Depois da criação:

```text
Código da sala
Link da sala
Botão copiar link
Lista de jogadores
Botão iniciar partida
```

O host deve conseguir iniciar a partida quando houver jogadores suficientes.

---

# 17. Join Room

Quando o usuário acessar:

```text
/room/:roomCode
```

e ainda não estiver identificado:

mostrar:

```text
Entrar na sala

Seu nome
[____________]

[ENTRAR]
```

Depois:

```text
Sala: Sexta-feira UNO
Código: A7K92

Jogadores:
● João
● Maria
● Pedro
● ...

Aguardando o host...
```

---

# 18. Game Screen

Criar uma mesa de UNO visualmente clara.

Deve existir:

```text
                jogador
                   ●

       jogador             jogador


              ┌────────┐
              │ discard│
              │  pile  │
              └────────┘

                 deck

        ───────────────────

             SUAS CARTAS
```

Mostrar claramente:

- jogadores;
- quantidade de cartas de cada jogador;
- jogador atual;
- direção;
- pilha de descarte;
- deck;
- mão do jogador;
- ações disponíveis;
- mensagens de sistema;
- estado da partida;
- vencedor.

Não transformar a tela em um dashboard cheio de cards.

O foco deve ser a mesa de jogo.

---

# 19. Design / UI

A interface deve ser **game-first**.

Use os assets existentes.

Não substitua as cartas existentes por cartas geradas via CSS.

As cartas devem utilizar as imagens/arte fornecidas.

A demo HTML existente é a referência principal para:

- dimensões;
- proporções;
- sombras;
- bordas;
- hover;
- flip;
- escala;
- posição;
- animações;
- interação;
- aparência geral.

Leia também o `.md` existente antes de implementar as animações.

---

# 20. Animações

As cartas devem parecer físicas e responsivas.

Implementar, conforme definido na documentação/demo:

- hover;
- lift;
- shadow;
- selected state;
- drag;
- drop;
- click;
- flip;
- draw;
- discard;
- card movement;
- turn transitions;
- smooth state transitions.

Priorize animações suaves e naturais.

Evite animações excessivamente longas.

A interação deve parecer instantânea.

---

# 21. Drag & Drop + Click

O jogador deve poder jogar uma carta de duas formas:

### Click

```text
click card
↓
card selected
↓
play
```

### Drag & Drop

```text
drag card
↓
discard pile
↓
drop
↓
play
```

As duas formas devem usar a mesma lógica de jogo.

Não crie duas implementações diferentes das regras.

A UI apenas dispara a mesma ação:

```ts
playCard(cardId)
```

---

# 22. Estado do frontend

Use Zustand apenas para estado realmente local/client-side.

Por exemplo:

```text
playerName
roomId
UI state
selectedCard
drag state
sound settings
```

Não use Zustand como fonte de verdade da partida.

O estado da partida vem do Colyseus.

Arquitetura:

```text
Colyseus
   ↓
authoritative game state

Zustand
   ↓
local UI state
```

Não duplique o game state inteiro no Zustand.

---

# 23. Som

Prepare a arquitetura para efeitos sonoros simples, caso os assets estejam disponíveis.

Exemplos:

- card draw;
- card play;
- card action;
- turn;
- UNO;
- victory.

Não adicione um sistema complexo de áudio.

Um pequeno hook/utilitário é suficiente.

---

# 24. Performance

Não faça otimizações prematuras.

Mas:

- evite renders desnecessários;
- não recrie listas de cartas sem necessidade;
- não coloque objetos enormes no Zustand;
- não faça polling;
- não faça requests HTTP para cada ação;
- use a sincronização realtime do Colyseus.

UNO é um jogo de baixíssima exigência de rede.

Priorize simplicidade.

---

# 25. URL routing

O frontend deve ter rotas simples:

```text
/
 /room/:roomCode
```

Não precisa de router complexo se uma solução simples for suficiente.

---

# 26. Developer experience

O projeto deve iniciar facilmente.

Quero comandos simples como:

```bash
npm install
npm run dev
```

ou equivalente.

Também quero:

```bash
npm run build
```

para validar o projeto inteiro.

Se possível, scripts separados:

```bash
npm run dev:web
npm run dev:server
npm run build:web
npm run build:server
```

Não criar scripts desnecessários.

---

# 27. TypeScript

Use TypeScript strict.

Evite:

```ts
any
```

quando um tipo simples resolver.

Não crie tipos excessivamente complexos.

Prefira tipos pequenos e explícitos.

---

# 28. Código

Estilo de implementação:

- pragmático;
- minimalista;
- legível;
- moderno;
- poucas abstrações;
- funções pequenas;
- nomes claros;
- sem comentários óbvios;
- sem código duplicado;
- sem overengineering.

O código deve parecer escrito por um **desenvolvedor sênior pragmático**, não por alguém tentando demonstrar quantos design patterns conhece.

Se uma função de 20 linhas resolve o problema, não transforme em cinco classes.

Se um objeto simples resolve, não crie uma classe.

Se uma abstração não possui pelo menos dois usos claros, provavelmente ela não é necessária.

---

# 29. Future extensibility

A arquitetura deve permitir posteriormente adicionar:

```text
Custom Rules
Game Modes
Mini-games
Voice
Statistics
Accounts
Rankings
Matchmaking
Spectator mode
```

Mas **NÃO implemente nada disso agora**.

Apenas não estruture o código de maneira que torne essas funcionalidades impossíveis.

Particularmente, o sistema de regras deve permitir adicionar futuramente coisas como:

```text
Rule 7:
    silence mode

Rule 9:
    reaction minigame

Other modes:
    custom deck
    custom actions
    etc.
```

Não implemente essas regras agora.

---

# 30. Não faça

Não adicionar:

- database;
- authentication;
- payment;
- matchmaking global;
- ranking;
- accounts;
- friends;
- chat complexo;
- admin panel;
- analytics;
- Redis;
- Docker apenas por padrão;
- Kubernetes;
- microservices;
- NestJS;
- GraphQL;
- REST API desnecessária;
- testes excessivos;
- abstrações excessivas.

O MVP deve permanecer pequeno.

---

# 31. Testing

Crie testes apenas para a parte que realmente merece proteção:

**game engine / rules.**

Principalmente:

- deck generation;
- valid card;
- invalid card;
- turn;
- direction;
- Skip;
- Reverse;
- Draw Two;
- Wild;
- Wild Draw Four;
- draw;
- UNO;
- victory;
- 2-player special cases.

Não é necessário criar uma enorme suíte de testes para componentes visuais neste momento.

---

# 32. README

Crie um README simples explicando:

```text
Project
Architecture
Requirements
Installation
Development
Build
Project structure
Game rules
```

Também documente brevemente:

- como criar uma sala;
- como entrar;
- como funciona reconnection;
- onde está o game engine;
- onde adicionar futuras regras.

Não escreva documentação gigantesca.

---

# 33. Critério de sucesso

Ao terminar, eu quero conseguir:

```text
1. npm install

2. npm run dev

3. abrir o frontend

4. criar uma sala

5. receber um código/link

6. abrir o link em outra aba/browser

7. entrar com outro nome

8. iniciar uma partida

9. jogar UNO normalmente

10. abrir outra aba e conectar outro jogador

11. atualizar uma página durante a partida

12. recuperar a sessão

13. terminar uma partida
```

Tudo isso deve funcionar sem banco de dados.

---

# 34. Ordem de implementação

Implemente nesta ordem:

### Fase 1

Monorepo + tooling.

### Fase 2

React app + Tailwind + estrutura visual.

### Fase 3

Colyseus server + Room.

### Fase 4

Lobby / create room / join room.

### Fase 5

Reconnection / localStorage.

### Fase 6

UNO game engine.

### Fase 7

Integração game engine + Colyseus.

### Fase 8

Game UI.

### Fase 9

Cards + assets + animations.

### Fase 10

Drag & drop + click interaction.

### Fase 11

Sound, se os assets existentes permitirem.

### Fase 12

Tests do game engine.

### Fase 13

Build final e limpeza.

---

# 35. Regra importante sobre os assets

Não gere novos assets se os assets necessários já existirem.

Não substitua a arte existente.

Não altere as imagens das cartas.

Use os assets fornecidos no projeto.

A demo HTML existente deve ser incorporada/organizada dentro da estrutura do projeto web de forma que ela possa servir como referência e, quando possível, compartilhar os mesmos assets/componentes.

---

# 36. Finalização

Ao terminar a implementação:

1. Execute o build.
2. Corrija erros TypeScript.
3. Corrija erros de lint, caso configurado.
4. Verifique o frontend.
5. Verifique o servidor.
6. Verifique o fluxo de criação de sala.
7. Verifique o fluxo de entrada.
8. Verifique reconnection.
9. Verifique uma partida completa.
10. Verifique as regras do UNO.
11. Remova código morto.
12. Remova abstrações desnecessárias.
13. Confirme que não foi introduzida nenhuma dependência desnecessária.

Não pare apenas depois de criar a estrutura.

**Entregue o MVP funcional.**

Se alguma decisão técnica não estiver explicitamente especificada, escolha a solução mais simples, moderna e alinhada com este projeto.

Não pergunte sobre decisões pequenas que podem ser resolvidas de forma razoável.

Só peça esclarecimento se existir uma ambiguidade que realmente impeça a implementação.

## Princípio final

> **Small codebase. Clear code. Server authoritative. Smooth UX. Ship fast.**
