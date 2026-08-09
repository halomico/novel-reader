export function MediaConnectionHint({ origin }: { origin: string | null }) {
  return origin ? <link rel="preconnect" href={origin} crossOrigin="" /> : null;
}
