/** Price from cost with a markup on cost (0.2 = +20 %). Note: +20 % markup = 16.7 % margin. */
export function applyMarkup(cost: number, markup: number): number {
  return cost * (1 + markup);
}

/** Margin on price that a markup on cost results in. */
export function marginFromMarkup(markup: number): number {
  return markup / (1 + markup);
}
