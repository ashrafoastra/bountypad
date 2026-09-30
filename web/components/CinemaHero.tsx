"use client";
/**
 * The opening shot. Full-bleed film behind the headline, letterbox bars that part on load like a
 * cinema curtain, a running UTC timecode, and a scroll-out: the frame shrinks and the title lifts
 * away as you move into the site. The film comes from NEXT_PUBLIC_HERO_VIDEO or /hero/hero.mp4.
 */
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { EASE, Magnetic, SplitWords } from "./motion";
import { SplitButton } from "./ui";

const SRC = process.env.NEXT_PUBLIC_HERO_VIDEO || "/hero/hero.mp4";

/** The trailer's chapters, in step with its shots (seconds). Our own type over the film: no AI text. */
const CHAPTERS: [number, string, string][] = [
  [0, "01", "Launch a coin in one signature."],
  [3, "02", "Every trade pays a fee."],
  [6, "03", "The fee fills a pot, on Solana."],
  [9, "04", "Name anyone on X. They do it in public."],
  [12, "05", "Verified automatically. Paid instantly."],
];

function Timecode() {
  const [t, setT] = useState("");
  useEffect(() => {
    const start = performance.now();
    const tick = () => {
      const d = new Date();
      const f = Math.floor(((performance.now() - start) / 1000 * 24) % 24);
      setT(`${d.toISOString().slice(11, 19)}:${String(f).padStart(2, "0")}`);
    };
    const id = setInterval(tick, 1000 / 24);
    return () => clearInterval(id);
  }, []);
  return <span className="num tabular-nums">{t || "00:00:00:00"}</span>;
}

export function CinemaHero({ light }: { light: boolean }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const [videoOk, setVideoOk] = useState(true);
  const [chapter, setChapter] = useState(0);
  const [playing, setPlaying] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  // The error can fire before hydration: check the element's own state once mounted.
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (v.error || v.networkState === 3) setVideoOk(false);
    else if (!v.paused && v.readyState > 2) setPlaying(true);
  }, []);
  // When the branded intro plays first (once per visit), the opening waits for it.
  const [D] = useState(() => {
    try { return typeof window !== "undefined" && location.pathname === "/" && sessionStorage.getItem("bp-intro") !== "1" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1.5 : 0; }
    catch { return 0; }
  });
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 0.88]);
  const lift = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "-35%"]);
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const dim = useTransform(scrollYProgress, [0, 1], [0.35, 0.8]);

  return (
    <section ref={ref} className="relative w-screen left-1/2 -translate-x-1/2 -mt-8 sm:-mt-10 h-[calc(100svh-64px)] min-h-[620px]">
      <motion.div className="absolute inset-0 overflow-hidden bg-[#0a0a0a] origin-top" style={{ scale }}>
        {videoOk && (
          <video ref={vid} className="absolute inset-0 w-full h-full object-cover" src={SRC} onPlaying={() => setPlaying(true)} autoPlay muted loop playsInline preload="auto"
            onError={() => setVideoOk(false)}
            onTimeUpdate={(e) => { const t = e.currentTarget.currentTime; let c = 0; CHAPTERS.forEach(([at], i) => { if (t >= at) c = i; }); setChapter(c); }} />
        )}
        {/* without a film: a slow light sweeping a dark stage */}
        {!videoOk && (
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_62%_40%,#2a2a27_0%,#121212_45%,#0a0a0a_80%)]" />
            {!reduce && <motion.div className="absolute -inset-x-1/2 top-0 h-full bg-[conic-gradient(from_200deg_at_50%_0%,transparent_0deg,rgba(242,241,238,0.06)_20deg,transparent_40deg)]"
              animate={{ rotate: [-8, 8, -8] }} transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }} />}
          </div>
        )}
        <motion.div className="absolute inset-0 bg-black" style={{ opacity: dim }} />
        <div className="absolute inset-0 bg-gradient-to-t from-[#101010] via-transparent to-[#101010]/40" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#101010]/85 via-[#101010]/20 to-transparent" />
      </motion.div>

      {/* letterbox: parts on load */}
      {!reduce && (<>
        <motion.div aria-hidden className="absolute left-0 right-0 top-0 h-1/2 bg-[#0a0a0a] z-20 origin-top" initial={{ scaleY: 1 }} animate={{ scaleY: 0 }} transition={{ duration: 1.6, delay: 0.2 + D, ease: [0.76, 0, 0.24, 1] }} />
        <motion.div aria-hidden className="absolute left-0 right-0 bottom-0 h-1/2 bg-[#0a0a0a] z-20 origin-bottom" initial={{ scaleY: 1 }} animate={{ scaleY: 0 }} transition={{ duration: 1.6, delay: 0.2 + D, ease: [0.76, 0, 0.24, 1] }} />
      </>)}

      {/* frame furniture */}
      <motion.div className="absolute inset-0 z-10 pointer-events-none" style={{ opacity: fade }}>
        <div className="absolute left-4 right-4 sm:left-8 sm:right-8 top-5 flex justify-between font-mono text-[10.5px] uppercase tracking-[.1em] text-mute">
          <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-red animate-pulse" />Live · Solana mainnet</span>
          <span className="hidden sm:inline">Bounty Pad · Reel 01</span>
          <Timecode />
        </div>
        {(["tl", "tr", "bl", "br"] as const).map((k) => (
          <span key={k} className={`absolute w-6 h-6 border-mute/60 ${k[0] === "t" ? "top-12 border-t" : "bottom-8 border-b"} ${k[1] === "l" ? "left-4 sm:left-8 border-l" : "right-4 sm:right-8 border-r"}`} />
        ))}
      </motion.div>

      {/* the trailer's chapter, synced with the film */}
      {videoOk && playing && (
        <motion.div className="absolute z-10 right-4 sm:right-8 top-20 sm:top-24 w-[min(420px,80vw)] text-right" style={{ opacity: fade }}>
          <AnimatePresence mode="wait">
            <motion.div key={chapter} initial={{ opacity: 0, y: 10, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8, filter: "blur(6px)" }} transition={{ duration: 0.6, ease: EASE }}>
              <div className="font-mono text-[11px] tracking-[.1em] text-mute">{CHAPTERS[chapter][1]} / 05</div>
              <div className="text-[20px] sm:text-[26px] tracking-[-0.02em] leading-tight mt-2">{CHAPTERS[chapter][2]}</div>
            </motion.div>
          </AnimatePresence>
          <div className="mt-4 ml-auto flex gap-1.5 w-40">
            {CHAPTERS.map((_, i) => <span key={i} className={`h-px flex-1 transition-colors duration-500 ${i <= chapter ? "bg-ink" : "bg-line-2"}`} />)}
          </div>
        </motion.div>
      )}

      <motion.div className="relative z-10 h-full max-w-[1320px] mx-auto px-4 sm:px-8 flex flex-col justify-end pb-16 sm:pb-20" style={{ y: lift, opacity: fade }}>
        <motion.div className="label flex items-center gap-3 mb-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 1.2 + D }}>
          <span className="w-8 h-px bg-mute" />Meme coins with a challenge · {light ? "Pot held on Solana" : "On-chain escrow"}
        </motion.div>
        <h1 className="display text-[64px] sm:text-[120px] lg:text-[168px] leading-[0.86]">
          <SplitWords trigger="mount" delay={1.0 + D} stagger={0.08} lines={["Make them", "earn it."]} lineClass={["", "text-mute"]} />
        </h1>
        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <motion.p className="text-[17px] sm:text-[19px] text-mute max-w-xl leading-relaxed" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, delay: 1.6 + D, ease: EASE }}>
            Launch a coin, name anyone on X, set the challenge. Every trade grows the pot. It pays out <span className="text-ink">only when they do it</span>, verified automatically.
          </motion.p>
          <motion.div className="flex flex-wrap gap-3" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, delay: 1.75 + D, ease: EASE }}>
            <Magnetic><SplitButton href="/launch">Launch a coin</SplitButton></Magnetic>
            <Magnetic strength={0.2}><a href="#challenges" className="btn btn-outline backdrop-blur-sm bg-black/20">Explore challenges</a></Magnetic>
          </motion.div>
        </div>
      </motion.div>

      {/* scroll cue */}
      <motion.div className="absolute z-10 left-1/2 -translate-x-1/2 bottom-5 hidden sm:flex flex-col items-center gap-2 label" style={{ opacity: fade }}>
        <span>Scroll</span>
        <span className="relative w-px h-8 bg-line overflow-hidden">
          {!reduce && <motion.span className="absolute left-0 top-0 w-px h-3 bg-ink" animate={{ y: [-12, 32] }} transition={{ duration: 1.6, repeat: Infinity, ease: EASE }} />}
        </span>
      </motion.div>
    </section>
  );
}
