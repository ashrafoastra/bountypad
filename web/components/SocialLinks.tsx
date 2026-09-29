"use client";
import type { LinkKind, TokenLinks } from "@bountypad/shared";

const PATHS: Record<LinkKind, string> = {
  website: "M12 2a10 10 0 100 20 10 10 0 000-20zm0 0c2.8 2.7 4.2 6 4.2 10S14.8 19.3 12 22m0-20C9.2 4.7 7.8 8 7.8 12s1.4 7.3 4.2 10M2.5 9h19M2.5 15h19",
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  telegram: "M21.5 3.5L2.8 10.7c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.4.8.8.8.4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8L22.9 5c.3-1.3-.5-1.9-1.4-1.5zM9 13.4l9.3-5.9-7.5 7-.3 3.3L9 13.4z",
  github: "M12 1.5a10.5 10.5 0 00-3.3 20.46c.52.1.72-.23.72-.5v-1.8c-2.92.64-3.54-1.4-3.54-1.4-.48-1.22-1.17-1.54-1.17-1.54-.95-.65.08-.64.08-.64 1.05.08 1.6 1.08 1.6 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.2 0-1.14.41-2.08 1.08-2.82-.1-.26-.47-1.33.1-2.78 0 0 .88-.28 2.88 1.08a10 10 0 015.25 0c2-1.36 2.88-1.08 2.88-1.08.57 1.45.2 2.52.1 2.78.67.74 1.08 1.68 1.08 2.82 0 4.04-2.46 4.93-4.8 5.19.38.33.71.97.71 1.96v2.9c0 .28.19.61.73.5A10.5 10.5 0 0012 1.5z",
  tiktok: "M16.6 2h-3.3v13.1a2.9 2.9 0 11-2.9-2.9c.3 0 .6 0 .9.1V8.9a6.2 6.2 0 105.3 6.1V8.6a8 8 0 004.4 1.4V6.7a4.5 4.5 0 01-4.4-4.7z",
  youtube: "M23 7.2a3 3 0 00-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 001 7.2 31 31 0 00.5 12a31 31 0 00.5 4.8 3 3 0 002.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 002.1-2.1 31 31 0 00.5-4.8 31 31 0 00-.5-4.8zM9.8 15.1V8.9L15.5 12l-5.7 3.1z",
};
const STROKE: Partial<Record<LinkKind, true>> = { website: true };
export const LINK_LABEL: Record<LinkKind, string> = { website: "Website", x: "X", telegram: "Telegram", github: "GitHub", tiktok: "TikTok", youtube: "YouTube" };

export function SocialIcon({ kind, size = 16 }: { kind: LinkKind; size?: number }) {
  return STROKE[kind]
    ? <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d={PATHS[kind]} /></svg>
    : <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d={PATHS[kind]} /></svg>;
}

/** The coin's social links as square icon buttons (only the ones the creator set). */
export function SocialLinks({ links }: { links: TokenLinks }) {
  const set = (Object.keys(LINK_LABEL) as LinkKind[]).filter((k) => links?.[k]);
  if (!set.length) return null;
  return (
    <div className="flex">
      {set.map((k, i) => (
        <a key={k} href={links[k]} target="_blank" rel="noopener noreferrer nofollow" title={LINK_LABEL[k]} aria-label={LINK_LABEL[k]}
          className={`w-8 h-8 flex items-center justify-center border border-line-2 text-mute hover:text-ink hover:border-ink transition-colors ${i ? "-ml-px" : ""}`}>
          <SocialIcon kind={k} size={14} />
        </a>
      ))}
    </div>
  );
}
