"use client";
import { useEffect, useRef, useState } from "react";
import {
  AreaSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, createChart,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import { CHART_TIMEFRAMES, type ChartTimeframe, type TokenChart as ChartData } from "@bountypad/shared";
import { api, useEvents } from "@/lib/api";
import { fmtPrice } from "@/lib/format";

type Mode = "price" | "mcap" | "pot";
const SUPPLY = 1_000_000_000;
const C = { bg: "#101010", grid: "#1d1d1b", text: "#a7a79f", line: "#3a3a36", up: "#5fcf8f", down: "#f0676a", ink: "#f2f1ee" };

/**
 * The coin's market chart (TradingView lightweight-charts): candles + volume from every trade
 * and pool sample, market-cap view, and the pot locked in escrow over time.
 */
export function TokenChart({ tokenId, ticker }: { tokenId: string; ticker: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ candles?: ISeriesApi<"Candlestick">; volume?: ISeriesApi<"Histogram">; pot?: ISeriesApi<"Area"> }>({});
  const [tf, setTf] = useState<ChartTimeframe>("1m");
  const [mode, setMode] = useState<Mode>("price");
  const [data, setData] = useState<ChartData | null>(null);
  const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number; v: number } | null>(null);
  const fitted = useRef("");

  const load = async () => { try { setData(await api<ChartData>(`/api/tokens/${tokenId}/chart?tf=${tf}`)); } catch { /* keep last */ } };
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [tokenId, tf]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEvents((e) => {
    if (e.tokenId !== tokenId || pending.current) return;
    pending.current = setTimeout(() => { pending.current = null; load(); }, 400);
  });

  // create the chart once
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: C.bg }, textColor: C.text, fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.line, scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 9 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#6e6e68", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#232321" },
        horzLine: { color: "#6e6e68", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#232321" },
      },
      localization: { priceFormatter: (p: number) => fmtPrice(p) },
    });
    chart.current = c;
    c.subscribeCrosshairMove((p) => {
      const cs = series.current.candles, vs = series.current.volume;
      const d = cs && p.seriesData.get(cs) as any, v = vs && p.seriesData.get(vs) as any;
      setHover(d && d.open !== undefined ? { o: d.open, h: d.high, l: d.low, c: d.close, v: v?.value ?? 0 } : null);
    });
    return () => { c.remove(); chart.current = null; series.current = {}; };
  }, []);

  // (re)build series when the mode changes, then feed data
  useEffect(() => {
    const c = chart.current;
    if (!c || !data) return;
    const s = series.current;
    const wantCandles = mode !== "pot";
    if (wantCandles && !s.candles) {
      if (s.pot) { c.removeSeries(s.pot); s.pot = undefined; }
      s.candles = c.addSeries(CandlestickSeries, {
        upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down,
        priceFormat: { type: "custom", formatter: (p: number) => fmtPrice(p), minMove: 1e-12 },
        priceLineColor: C.ink, priceLineStyle: LineStyle.Dotted,
      });
      s.volume = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
    if (!wantCandles && !s.pot) {
      if (s.candles) { c.removeSeries(s.candles); s.candles = undefined; }
      if (s.volume) { c.removeSeries(s.volume); s.volume = undefined; }
      s.pot = c.addSeries(AreaSeries, {
        lineColor: C.ink, topColor: "rgba(242,241,238,0.16)", bottomColor: "rgba(242,241,238,0)", lineWidth: 2,
        priceFormat: { type: "custom", formatter: (p: number) => `${p.toFixed(4)} SOL`, minMove: 1e-9 },
      });
    }
    const k = mode === "mcap" ? SUPPLY : 1;
    if (s.candles) {
      s.candles.applyOptions({ priceFormat: mode === "mcap" ? { type: "custom", formatter: (p: number) => `${p.toFixed(p >= 100 ? 0 : 2)} SOL`, minMove: 0.01 } : { type: "custom", formatter: (p: number) => fmtPrice(p), minMove: 1e-12 } });
      s.candles.setData(data.candles.map((x) => ({ time: x.time as UTCTimestamp, open: x.open * k, high: x.high * k, low: x.low * k, close: x.close * k })));
      s.volume!.setData(data.candles.map((x) => ({ time: x.time as UTCTimestamp, value: x.volume, color: x.close >= x.open ? "rgba(95,207,143,0.35)" : "rgba(240,103,106,0.35)" })));
    }
    if (s.pot) {
      const pts = data.pot.length ? data.pot : [];
      s.pot.setData(pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    }
    c.applyOptions({ localization: { priceFormatter: mode === "price" ? (p: number) => fmtPrice(p) : (p: number) => p.toFixed(mode === "pot" ? 4 : 2) } });
    const key = `${mode}:${tf}`;
    if (fitted.current !== key) {
      // Few candles: keep them readable (room for ~36) instead of stretching them across the chart.
      const n = mode === "pot" ? data.pot.length : data.candles.length;
      if (n > 0 && n < 36) c.timeScale().setVisibleLogicalRange({ from: n - 36, to: n + 3 });
      else c.timeScale().fitContent();
      fitted.current = key;
    }
  }, [data, mode, tf]);

  const last = data?.candles[data.candles.length - 1];
  const shown = hover ?? (last ? { o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume } : null);
  const empty = data && (mode === "pot" ? data.pot.length === 0 : data.candles.length === 0);
  const fmt = (v: number) => mode === "mcap" ? `${(v * SUPPLY).toFixed(2)}` : fmtPrice(v);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line">
        <div className="seg-group">
          {([["price", "Price"], ["mcap", "MCap"], ["pot", "Pot"]] as const).map(([k, l]) => (
            <button key={k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
        {mode !== "pot" && (
          <div className="seg-group">
            {(Object.keys(CHART_TIMEFRAMES) as ChartTimeframe[]).map((k) => (
              <button key={k} className={tf === k ? "on" : ""} onClick={() => setTf(k)}>{k}</button>
            ))}
          </div>
        )}
      </div>
      <div className="px-4 h-8 flex items-center gap-4 font-mono text-[11px] text-mute border-b border-line overflow-x-auto scrollbar-none whitespace-nowrap">
        {mode === "pot" ? (
          <span>Pot, SOL{data?.pot.length ? <> · <span className="text-ink">{data.pot[data.pot.length - 1].value.toFixed(4)}</span></> : null}</span>
        ) : shown ? (
          <>
            <span>${ticker}/SOL{mode === "mcap" ? " · MCap" : ""}</span>
            <span>O <span className={shown.c >= shown.o ? "text-green" : "text-red"}>{fmt(shown.o)}</span></span>
            <span>H <span className={shown.c >= shown.o ? "text-green" : "text-red"}>{fmt(shown.h)}</span></span>
            <span>L <span className={shown.c >= shown.o ? "text-green" : "text-red"}>{fmt(shown.l)}</span></span>
            <span>C <span className={shown.c >= shown.o ? "text-green" : "text-red"}>{fmt(shown.c)}</span></span>
            <span>Vol <span className="text-ink">{shown.v.toFixed(3)}</span></span>
          </>
        ) : <span>${ticker}/SOL</span>}
      </div>
      <div className="relative h-[340px] sm:h-[420px]">
        <div ref={el} className="absolute inset-0" />
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="label">{mode === "pot" ? "The pot fills with the first fee claim" : "Waiting for the first trade"}</span>
          </div>
        )}
      </div>
    </div>
  );
}
