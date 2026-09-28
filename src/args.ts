/**
 * parseArgs reads "-1" as a flag. Join a negative number onto the long option
 * before it, so `--normalize -1` works like `--normalize=-1`.
 */
export function joinNegativeNumbers(args: string[]) {
  const out: string[] = [];
  for (const a of args) {
    const prev = out[out.length - 1];
    if (/^-\d/.test(a) && prev?.startsWith('--') && !prev.includes('=')) out[out.length - 1] = `${prev}=${a}`;
    else out.push(a);
  }
  return out;
}
