"use client";
/**
 * The motion system. One vocabulary across the site, tuned by hand (no default easings):
 *  - EASE: a long, confident out-curve (things arrive and settle, they don't bounce).
 *  - Text rises out of a mask, word by word. Blocks unveil once, when they enter the view.
 *  - The cursor is the brand's reticle; it widens over anything you can act on.
 *  - Everything turns off under prefers-reduced-motion.
 */
import Lenis from "lenis";
import { motion, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, useVelocity, useAnimationFrame, type MotionValue } from "motion/react";
import { Children, useEffect, useRef, useState, type ReactNode } from "react";

export const EASE = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

/** Inertial page scroll (desktop pointers only: phones keep their native scroll). */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(pointer: coarse)").matches) return;
    const lenis = new Lenis({ duration: 1.05, easing: (t) => 1 - Math.pow(1 - t, 4), smoothWheel: true });
    let id = 0;
    const raf = (t: number) => { lenis.raf(t); id = requestAnimationFrame(raf); };
    id = requestAnimationFrame(raf);
    // in-page anchors glide too
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href^='#'], a[href^='/#']") as HTMLAnchorElement | null;
      if (!a || (a.pathname !== location.pathname && a.getAttribute("href")!.startsWith("/#"))) return;
      const el = document.querySelector(a.hash);
      if (el) { e.preventDefault(); lenis.scrollTo(el as HTMLElement, { offset: -88 }); }
    };
    document.addEventListener("click", onClick);
    return () => { cancelAnimationFrame(id); document.removeEventListener("click", onClick); lenis.destroy(); };
  }, []);
  return null;
}

/**
 * The reticle cursor: a fine crosshair that follows the pointer with a little lag, and opens
 * into a bracketed square over links and buttons. Hidden on touch screens.
 */
export function Cursor() {
  const x = useMotionValue(-100), y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 900, damping: 60, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 900, damping: 60, mass: 0.4 });
  const [mode, setMode] = useState<"idle" | "hover" | "text" | "down">("idle");
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setOn(true);
    document.documentElement.classList.add("has-cursor");
    const move = (e: PointerEvent) => {
      x.set(e.clientX); y.set(e.clientY);
      const t = e.target as HTMLElement;
      const interactive = t.closest?.("a, button, [role=button], select, label, summary, input[type=range]");
      const text = t.closest?.("input, textarea, [contenteditable=true]");
      setMode((m) => (m === "down" ? m : text ? "text" : interactive ? "hover" : "idle"));
    };
    const down = () => setMode("down");
    const up = () => setMode("idle");
    const leave = () => { x.set(-100); y.set(-100); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    document.addEventListener("pointerleave", leave);
    return () => {
      document.documentElement.classList.remove("has-cursor");
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up); document.removeEventListener("pointerleave", leave);
    };
  }, [x, y]);
  if (!on) return null;
  const size = mode === "hover" ? 40 : mode === "down" ? 16 : mode === "text" ? 2 : 22;
  return (
    <motion.div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[100] mix-blend-difference" style={{ x: sx, y: sy }}>
      <motion.div className="relative -translate-x-1/2 -translate-y-1/2" animate={{ width: size, height: mode === "text" ? 22 : size }} transition={{ duration: 0.28, ease: EASE }}>
        {/* four corner ticks = the brand's brackets */}
        {(["tl", "tr", "bl", "br"] as const).map((k) => (
          <motion.span key={k} className={`absolute w-[7px] h-[7px] border-white ${k[0] === "t" ? "top-0 border-t" : "bottom-0 border-b"} ${k[1] === "l" ? "left-0 border-l" : "right-0 border-r"}`}
            animate={{ opacity: mode === "text" ? 0 : 1 }} />
        ))}
        <motion.span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white" animate={{ width: mode === "text" ? 1 : 3, height: mode === "text" ? 22 : 3 }} transition={{ duration: 0.2 }} />
      </motion.div>
    </motion.div>
  );
}

/** A fine film grain over the whole page: the flat black stops looking like a template. */
export function Grain() {
  return (
    <div aria-hidden className="grain pointer-events-none fixed inset-0 z-[90] opacity-[0.045] mix-blend-screen" />
  );
}

/** Unveil once when it enters the view: rises 24px and sharpens. */
export function Reveal({ children, delay = 0, y = 24, className = "", as = "div" }: { children: ReactNode; delay?: number; y?: number; className?: string; as?: "div" | "section" | "li" }) {
  const reduce = useReducedMotion();
  const M = motion[as];
  return (
    <M className={className} initial={reduce ? false : { opacity: 0, y, filter: "blur(6px)" }} whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }} transition={{ duration: 1.1, delay, ease: EASE }}>
      {children}
    </M>
  );
}

/**
 * Headline text rising out of a mask, word by word. Lines are kept: pass them as an array.
 * Words stay real text (selectable, readable by screen readers as one sentence).
 */
export function SplitWords({ lines, className = "", delay = 0, stagger = 0.06, lineClass = [] as string[], trigger = "view" as "view" | "mount" }: {
  lines: string[]; className?: string; delay?: number; stagger?: number; lineClass?: string[]; trigger?: "view" | "mount";
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  const show = trigger === "mount" || seen;
  let i = 0;
  return (
    <span ref={ref} className={className} aria-label={lines.join(" ")}>
      {lines.map((line, li) => (
        <span key={li} className={`block ${lineClass[li] ?? ""}`} aria-hidden>
          {line.split(" ").map((w, wi) => {
            const n = i++;
            return (
              <span key={wi} className="inline-block overflow-hidden align-bottom pb-[0.08em] -mb-[0.08em] mr-[0.24em] last:mr-0">
                <motion.span className="inline-block will-change-transform" initial={reduce ? false : { y: "108%", rotate: 4 }}
                  animate={show ? { y: "0%", rotate: 0 } : undefined} transition={{ duration: 1.15, delay: delay + n * stagger, ease: EASE }}>
                  {w}
                </motion.span>
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}

/** Pulls its child a little toward the pointer, then springs back. For primary actions. */
export function Magnetic({ children, strength = 0.28, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(0, { stiffness: 260, damping: 18, mass: 0.6 });
  const y = useSpring(0, { stiffness: 260, damping: 18, mass: 0.6 });
  return (
    <motion.div ref={ref} className={`inline-block ${className}`} style={{ x, y }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const r = ref.current!.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => { x.set(0); y.set(0); }}>
      {children}
    </motion.div>
  );
}

/**
 * A light that follows the pointer across a hairline frame (sets --mx/--my; the `.spot` class
 * paints it). Put on any container.
 */
export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    el.addEventListener("pointermove", move);
    return () => el.removeEventListener("pointermove", move);
  }, []);
  return ref;
}

/**
 * An endless row that drifts left, and runs faster (or backwards) with the scroll speed.
 * Content is rendered twice so the loop never shows a gap.
 */
export function VelocityMarquee({ children, base = 40, className = "" }: { children: ReactNode; base?: number; className?: string }) {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const smooth = useSpring(velocity, { damping: 50, stiffness: 300 });
  const factor = useTransform(smooth, [-2000, 0, 2000], [-4, 1, 4], { clamp: false });
  const x = useMotionValue(0);
  const track = useRef<HTMLDivElement>(null);
  useAnimationFrame((_, delta) => {
    if (reduce || !track.current) return;
    const w = track.current.scrollWidth / 2;
    if (!w) return;
    let next = x.get() - (base * factor.get() * delta) / 1000;
    if (next <= -w) next += w;
    if (next > 0) next -= w;
    x.set(next);
  });
  return (
    <div className={`overflow-hidden ${className}`}>
      <motion.div ref={track} className="flex w-max" style={{ x }}>
        <div className="flex shrink-0">{children}</div>
        <div className="flex shrink-0" aria-hidden>{children}</div>
      </motion.div>
    </div>
  );
}

/** A hairline that draws itself from left to right when it enters the view. */
export function DrawLine({ className = "", delay = 0, vertical = false }: { className?: string; delay?: number; vertical?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.span aria-hidden className={`block bg-line ${vertical ? "w-px h-full origin-top" : "h-px w-full origin-left"} ${className}`}
      initial={reduce ? false : vertical ? { scaleY: 0 } : { scaleX: 0 }} whileInView={vertical ? { scaleY: 1 } : { scaleX: 1 }}
      viewport={{ once: true }} transition={{ duration: 1.4, delay, ease: EASE_IN_OUT }} />
  );
}

/** Children appear one after another when the group enters the view. */
export function Stagger({ children, className = "", gap = 0.07, y = 18 }: { children: ReactNode; className?: string; gap?: number; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : "hidden"} whileInView="show" viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}>
      {Children.map(children, (c) => (
        <motion.div variants={{ hidden: { opacity: 0, y }, show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE } } }}>{c}</motion.div>
      ))}
    </motion.div>
  );
}

/** Scroll progress of an element through the viewport, 0 → 1 (for scroll-linked scenes). */
export function useSectionProgress(offset: ["start end" | "start start" | "start center", "end start" | "end end" | "end center"] = ["start end", "end start"]) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset });
  return { ref, progress: scrollYProgress as MotionValue<number> };
}
