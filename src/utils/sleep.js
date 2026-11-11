/**
 * Pausa a execução por `ms` milissegundos.
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Inteiro aleatório no intervalo [min, max].
 * `random` é injetável para tornar os testes determinísticos.
 */
export function randomBetween(min, max, random = Math.random) {
  if (max < min) [min, max] = [max, min];
  return Math.floor(min + random() * (max - min + 1));
}
