export function extractInfoHash(magnet: string): string | null {
  try {
    const url = new URL(magnet);
    if (url.protocol !== 'magnet:') return null;
    const xt = url.searchParams.get('xt');
    if (!xt) return null;
    if (xt.startsWith('urn:btih:')) {
      return xt.slice(9).toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeMagnet(magnet: string): string {
  try {
    const url = new URL(magnet);
    if (url.protocol !== 'magnet:') return magnet;
    const ih = extractInfoHash(magnet);
    if (!ih) return magnet;
    const dn = url.searchParams.get('dn');
    let out = `magnet:?xt=urn:btih:${ih.toLowerCase()}`;
    if (dn) out += `&dn=${encodeURIComponent(dn)}`;
    const tr = url.searchParams.getAll('tr');
    for (const t of tr) {
      out += `&tr=${encodeURIComponent(t)}`;
    }
    return out;
  } catch {
    return magnet;
  }
}

export function dedupeByInfoHash<T extends { magnet: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const ih = extractInfoHash(item.magnet);
    if (!ih) {
      result.push(item);
      continue;
    }
    if (seen.has(ih)) continue;
    seen.add(ih);
    result.push(item);
  }
  return result;
}
