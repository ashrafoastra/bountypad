"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedEvent } from "@bountypad/shared";

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export class ApiError extends Error {}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as any) };
  if (init?.json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(API + path, {
    ...init,
    headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as any).error ?? `Request failed (${res.status})`);
  return body as T;
}

type Listener = (e: FeedEvent) => void;
let source: EventSource | null = null;
const listeners = new Set<Listener>();

/** One shared SSE connection for the whole app. */
export function useEvents(fn: Listener) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    if (!source) {
      source = new EventSource(API + "/api/events");
      source.onmessage = (m) => {
        try { const ev = JSON.parse(m.data) as FeedEvent; listeners.forEach((x) => x(ev)); } catch {}
      };
    }
    return () => { listeners.delete(l); };
  }, []);
}

/** Fetch + refetch on an interval and whenever a relevant live event arrives. */
export function useLive<T>(path: string | null, opts: { every?: number; on?: (e: FeedEvent) => boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>(path)); setError(null); } catch (e) { setError((e as Error).message); }
  }, [path]);
  useEffect(() => {
    load();
    const t = setInterval(load, opts.every ?? 5000);
    return () => clearInterval(t);
  }, [load, opts.every]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEvents((e) => {
    if (opts.on && !opts.on(e)) return;
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; load(); }, 250);
  });
  return { data, error, reload: load };
}

export function useHealth() {
  return useLive<{ ok: boolean; sim: boolean; solUsd: number; privy: boolean }>("/api/health", { every: 60000, on: () => false });
}
