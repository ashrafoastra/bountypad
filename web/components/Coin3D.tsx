"use client";
/**
 * The Bounty Pad coin, in real-time 3D: a heavy black-metal coin with the brand mark (a reticle
 * around a check) struck on both faces and a milled edge. It turns slowly, leans toward the
 * pointer, and catches a moving studio light. Plain three.js, loaded only in the browser.
 */
import { useEffect, useRef } from "react";

/** The coin face, drawn once on a canvas: dark metal, the mark raised in off-white, fine text ring. */
function faceTexture(THREE: typeof import("three"), size = 1024) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const cx = size / 2, r = size / 2;
  // base: brushed dark metal
  const base = g.createRadialGradient(cx * 0.8, cx * 0.7, 10, cx, cx, r);
  base.addColorStop(0, "#3a3a37"); base.addColorStop(0.55, "#1d1d1c"); base.addColorStop(1, "#0b0b0b");
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) { // concentric brushing
    g.strokeStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cx, Math.random() * r, 0, Math.PI * 2); g.stroke();
  }
  // rims
  g.strokeStyle = "rgba(242,241,238,0.85)"; g.lineWidth = size * 0.012;
  g.beginPath(); g.arc(cx, cx, r * 0.93, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = "rgba(242,241,238,0.25)"; g.lineWidth = size * 0.004;
  g.beginPath(); g.arc(cx, cx, r * 0.72, 0, Math.PI * 2); g.stroke();
  // text ring
  g.fillStyle = "rgba(242,241,238,0.75)";
  g.font = `500 ${size * 0.042}px ui-monospace, "Geist Mono", monospace`;
  const text = "BOUNTY PAD · PAID FOR THE ACTION · MAKE THEM EARN IT · ";
  const chars = text.split("");
  chars.forEach((ch, i) => {
    const a = (i / chars.length) * Math.PI * 2 - Math.PI / 2;
    g.save(); g.translate(cx + Math.cos(a) * r * 0.825, cx + Math.sin(a) * r * 0.825); g.rotate(a + Math.PI / 2);
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ch, 0, 0); g.restore();
  });
  // the mark: reticle + check, struck in off-white
  const s = size / 64 * 0.62, o = cx - 32 * s;
  g.save(); g.translate(o, o); g.scale(s, s);
  g.strokeStyle = "#f2f1ee"; g.lineWidth = 3.4; g.lineCap = "square";
  g.shadowColor = "rgba(0,0,0,0.7)"; g.shadowBlur = 6; g.shadowOffsetY = 1.5;
  g.beginPath(); g.arc(32, 32, 14.5, 0, Math.PI * 2); g.stroke();
  for (const [x1, y1, x2, y2] of [[32, 7, 32, 16], [32, 48, 32, 57], [7, 32, 16, 32], [48, 32, 57, 32]]) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
  g.beginPath(); g.moveTo(25.5, 32.5); g.lineTo(30, 37); g.lineTo(38.5, 28); g.stroke();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  // cylinder caps map the canvas turned a quarter: turn it back so the mark reads upright
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2;
  return t;
}

/** Milled edge: fine vertical ridges as a bump map. */
function edgeTexture(THREE: typeof import("three")) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 32;
  const g = c.getContext("2d")!;
  for (let x = 0; x < 1024; x += 4) { g.fillStyle = x % 8 ? "#222" : "#bbb"; g.fillRect(x, 0, 4, 32); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function Coin3D({ className = "" }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      if (disposed) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      el.appendChild(renderer.domElement);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      camera.position.set(0, 0, 7.2);

      const face = faceTexture(THREE);
      const edge = edgeTexture(THREE);
      edge.repeat.set(1, 1);
      const faceMat = new THREE.MeshPhysicalMaterial({ map: face, metalness: 0.9, roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.25 });
      const edgeMat = new THREE.MeshPhysicalMaterial({ color: "#2a2a28", metalness: 1, roughness: 0.3, bumpMap: edge, bumpScale: 0.6 });
      const geo = new THREE.CylinderGeometry(1.6, 1.6, 0.2, 128, 1, false);
      const coin = new THREE.Mesh(geo, [edgeMat, faceMat, faceMat]);
      coin.rotation.x = Math.PI / 2; // face the camera
      const pivot = new THREE.Group();
      pivot.add(coin);
      scene.add(pivot);

      const key = new THREE.SpotLight("#ffffff", 60, 20, Math.PI / 7, 0.6, 1.4);
      key.position.set(3, 3, 5); scene.add(key);
      const rim = new THREE.PointLight("#9fe8bf", 6, 12); rim.position.set(-3, -1.5, -1); scene.add(rim);
      scene.add(new THREE.AmbientLight("#ffffff", 0.15));

      const resize = () => {
        const w = el.clientWidth, h = el.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize); ro.observe(el);

      let tx = 0, ty = 0; // pointer tilt target
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        tx = ((e.clientX - (r.left + r.width / 2)) / r.width) * 0.9;
        ty = ((e.clientY - (r.top + r.height / 2)) / r.height) * 0.7;
      };
      window.addEventListener("pointermove", onMove);

      let visible = true;
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
      io.observe(el);
      const clock = new THREE.Clock();
      let raf = 0, spin = 0;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        if (!visible) return;
        const t = clock.getElapsedTime(), dt = Math.min(clock.getDelta(), 0.05);
        spin += reduce ? 0 : 0.35 * (dt || 0.016);
        pivot.rotation.y += ((tx + Math.sin(spin) * 0.55) - pivot.rotation.y) * 0.05;
        pivot.rotation.x += ((ty + Math.cos(spin * 0.7) * 0.18) - pivot.rotation.x) * 0.05;
        pivot.position.y = reduce ? 0 : Math.sin(t * 0.9) * 0.06;
        key.position.x = Math.sin(t * 0.4) * 4;
        renderer.render(scene, camera);
      };
      loop();

      cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
        window.removeEventListener("pointermove", onMove);
        geo.dispose(); faceMat.dispose(); edgeMat.dispose(); face.dispose(); edge.dispose(); pmrem.dispose(); renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, []);
  return <div ref={host} className={className} aria-hidden />;
}
