type Props = {
  /** O que está pendente agora — 2, 4, 6… enquanto a pilha for respondida. */
  amount: number;
  /** Quem tem a vez, e portanto a escolha entre empilhar e pagar. */
  owner: string;
};

/**
 * O acumulado do empilhamento, na lateral da mesa. Fica fora das pilhas de
 * propósito: o número não é do descarte nem do monte, é uma dívida com quem
 * tem a vez — e é grande porque decidir se dá para empilhar depende dele.
 *
 * Só aparece com a regra ligada e a pilha de pé; quem o desenha remonta a cada
 * mudança do total, e é a remontagem que dispara o `px-pop` a cada carta nova.
 */
export function StackCounter({ amount, owner }: Props) {
  return (
    // `pointer-events-none`: na tela estreita ele encosta no monte, e um aviso
    // nunca deve ser o que impede a compra que ele está anunciando.
    <div className="px-slab px-pop pointer-events-none absolute top-1/2 left-0 flex w-14 -translate-y-1/2 flex-col items-center gap-1 px-1 py-3 sm:w-20 sm:px-2">
      <span className="px-label">compra</span>
      <span
        className="text-2xl leading-none font-bold sm:text-3xl"
        style={{ color: "var(--mark)", textShadow: "2px 2px 0 var(--rim)" }}
      >
        +{amount}
      </span>
      <span className="px-label max-w-full truncate">{owner}</span>
    </div>
  );
}
