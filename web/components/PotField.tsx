"use client";
/**
 * "The pot", as a living object: thousands of points forming a slowly breathing sphere, while
 * streams of particles spiral in from the edges and settle into it (every trade feeding the pot).
 * A few points burn green: fees already paid out. The whole thing leans toward the pointer.
 * Plain three.js with a small custom shader, loaded only in the browser; pauses off screen.
 */
import { useEffect, useRef } from "react";

const VERT = /* glsl */ `
uniform float uTime;
uniform float uPixel;
attribute float aSeed;
attribute float aKind;     // 0 = shell, 1 = inflow
attribute vec3 aFrom;      // inflow start
varying float vAlpha;
varying float vGreen;

// cheap 3D noise
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }

void main(){
  vec3 p = position;
  float breathe = 1.0 + 0.035*sin(uTime*0.8 + aSeed*6.2831);
  if (aKind < 0.5) {
    float n = noise(p*1.6 + vec3(0.0, uTime*0.25, 0.0));
    p *= breathe * (0.92 + n*0.16);
    vAlpha = 0.55 + 0.45*n;
  } else {
    // spiral from aFrom into the shell, looping forever
    float t = fract(uTime*0.12 + aSeed);
    float e = t*t*(3.0-2.0*t);
    float ang = (1.0-e)*6.0 + aSeed*12.0;
    vec3 from = aFrom;
    vec3 to = normalize(from) * 1.02;
    vec3 q = mix(from, to, e);
    q.xz = mat2(cos(ang),-sin(ang),sin(ang),cos(ang)) * q.xz * (0.6 + 0.4*(1.0-e)) + q.xz*0.4*e;
    p = q;
    vAlpha = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.85, 1.0, t)) * 0.9;
  }
  vGreen = step(0.985, aSeed);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (aKind < 0.5 ? 2.4 : 3.6) + vGreen*2.2;
  gl_PointSize = size * uPixel * (3.2 / -mv.z);
}
`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying float vGreen;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float soft = smoothstep(0.5, 0.0, d);
  vec3 ink = vec3(0.949, 0.945, 0.933);
  vec3 green = vec3(0.373, 0.812, 0.561);
  gl_FragColor = vec4(mix(ink, green, vGreen), soft * vAlpha);
}
`;

export function PotField({ className = "", density = 1 }: { className?: string; density?: number }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      if (disposed) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
      const dpr = Math.min(window.devicePixelRatio, 2);
      renderer.setPixelRatio(dpr);
      el.appendChild(renderer.domElement);
      Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block" });

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
      camera.position.set(0, 0, 5.6);

      const SHELL = Math.round(5200 * density), FLOW = Math.round(1400 * density), N = SHELL + FLOW;
      const pos = new Float32Array(N * 3), from = new Float32Array(N * 3), seed = new Float32Array(N), kind = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        seed[i] = Math.random();
        if (i < SHELL) {
          // even points on a sphere (golden spiral)
          const k = i + 0.5, phi = Math.acos(1 - (2 * k) / SHELL), th = Math.PI * (1 + Math.sqrt(5)) * k;
          pos.set([Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi)], i * 3);
        } else {
          kind[i] = 1;
          const a = Math.random() * Math.PI * 2, r = 2.6 + Math.random() * 1.6, y = (Math.random() - 0.5) * 2.4;
          from.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aFrom", new THREE.BufferAttribute(from, 3));
      geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
      geo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uPixel: { value: dpr } },
      });
      const points = new THREE.Points(geo, mat);
      const group = new THREE.Group();
      group.add(points);
      scene.add(group);

      const resize = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize); ro.observe(el);

      let tx = 0, ty = 0;
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        tx = ((e.clientX - (r.left + r.width / 2)) / r.width) * 0.8;
        ty = ((e.clientY - (r.top + r.height / 2)) / r.height) * 0.5;
      };
      window.addEventListener("pointermove", onMove);
      let visible = true;
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
      io.observe(el);

      const clock = new THREE.Clock();
      let raf = 0;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        if (!visible) return;
        const t = reduce ? 0 : clock.getElapsedTime();
        mat.uniforms.uTime.value = t;
        group.rotation.y += ((t * 0.08 + tx) - group.rotation.y) * 0.04;
        group.rotation.x += ((0.25 + ty) - group.rotation.x) * 0.04;
        renderer.render(scene, camera);
      };
      loop();
      cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
        window.removeEventListener("pointermove", onMove);
        geo.dispose(); mat.dispose(); renderer.dispose(); renderer.domElement.remove();
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, [density]);
  return <div ref={host} className={className} aria-hidden />;
}
