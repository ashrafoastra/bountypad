"use client";
import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";

/**
 * Hero composition: the 3D Bounty Pad coin (Higgsfield render of the logo) with the story's
 * objects orbiting it: the challenge (cashtag post), the locked pot (glass vault), the proof
 * (verified badge), the fees (coins). Mouse parallax gives depth; each object bobs on its own clock.
 */
const OBJECTS = [
  { src: "/brand/cashtag-bubble.webp", alt: "", size: 132, x: "4%", y: "10%", depth: 26, r: -8, d: 6.5, delay: 0.2 },
  { src: "/brand/vault-lock.webp", alt: "", size: 150, x: "71%", y: "4%", depth: 34, r: 7, d: 7.2, delay: 0.5 },
  { src: "/brand/verified-badge.webp", alt: "", size: 112, x: "79%", y: "44%", depth: 22, r: 10, d: 5.8, delay: 0.8 },
  { src: "/brand/coin-stack.webp", alt: "", size: 120, x: "2%", y: "66%", depth: 30, r: -4, d: 6.9, delay: 1.1 },
  { src: "/brand/coin-tilt.webp", alt: "", size: 72, x: "26%", y: "84%", depth: 44, r: 18, d: 5.2, delay: 1.4 },
  { src: "/brand/coin-tilt.webp", alt: "", size: 54, x: "30%", y: "0%", depth: 50, r: -24, d: 4.8, delay: 1.7 },
];

function Floating({ o, mx, my, i }: { o: (typeof OBJECTS)[number]; mx: MotionValue<number>; my: MotionValue<number>; i: number }) {
  const tx = useTransform(mx, (v) => v * o.depth);
  const ty = useTransform(my, (v) => v * o.depth);
  return (
    <motion.div
      className="absolute"
      style={{ left: o.x, top: o.y, x: tx, y: ty, width: `${(o.size / 560) * 100}%`, aspectRatio: "1 / 1" }}
      initial={{ opacity: 0, scale: 0.6, filter: "blur(10px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{ delay: 0.5 + i * 0.12, duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={o.src} alt={o.alt} width={o.size} height={o.size} draggable={false}
        className="bob drop w-full h-full select-none"
        style={{ ["--r" as string]: `${o.r}deg`, ["--d" as string]: `${o.d}s`, ["--delay" as string]: `-${o.delay}s` }} />
    </motion.div>
  );
}

export function Hero3D({ children }: { children?: React.ReactNode }) {
  const mx = useMotionValue(0), my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 60, damping: 18 }), sy = useSpring(my, { stiffness: 60, damping: 18 });
  const coinRotY = useTransform(sx, (v) => v * 16);
  const coinRotX = useTransform(sy, (v) => v * -12);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      mx.set(e.clientX / window.innerWidth - 0.5);
      my.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [mx, my]);

  return (
    <div className="relative w-full aspect-square max-w-[560px] mx-auto [perspective:1200px]">
      <div className="halo" />
      <div className="reticle reticle-spin no-cross w-[88%] h-[88%] border-dashed" />
      <div className="reticle w-[62%] h-[62%]" />
      <div className="reticle w-[36%] h-[36%]" />
      {OBJECTS.map((o, i) => <Floating key={i} o={o} mx={sx} my={sy} i={i} />)}
      <motion.div
        className="absolute left-1/2 top-1/2 w-[54%] -translate-x-1/2 -translate-y-1/2"
        style={{ rotateY: coinRotY, rotateX: coinRotX, transformStyle: "preserve-3d" }}
        initial={{ opacity: 0, scale: 0.7, rotateZ: -12 }}
        animate={{ opacity: 1, scale: 1, rotateZ: 0 }}
        transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/coin-3d.webp" alt="Bounty Pad coin" width={640} height={640} draggable={false}
          className="bob w-full h-auto select-none drop-shadow-[0_40px_60px_rgba(0,0,0,.6)]" style={{ ["--d" as string]: "7s" }} />
      </motion.div>
      {children}
    </div>
  );
}
