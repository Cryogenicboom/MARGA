import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus, X } from 'lucide-react';
import { Disclosure, KeyValues } from './Section';
import { StatusBadge } from './StatusBadge';
import { fmtDistance, fmtLatLon } from './format';
import { ROVER_BASE, solLabel, type RoverView as RoverViewData, type RoverViewsDataset } from '../services/roverViews';
import { calculateMarsDistanceMeters } from '../services/routeService';

/** Where the live map shows through the panel (Street View's map inset), in panel pixels from the bottom-left. */
const INSET = { left: 12, bottom: 12, width: 300, height: 200 };
const FOV_MIN = 25;
const FOV_MAX = 100;
const PITCH_MIN = -55;
const PITCH_MAX = 25;

const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p; gl_Position = vec4(p, 0.0, 1.0); }`;
// Equirectangular panorama, site frame: column 0 = north, azimuth clockwise; rows from elTop down to elBot.
const FS = `precision highp float;
varying vec2 v;
uniform sampler2D tex;
uniform float yaw, pitch, tanHalf, aspect, elTop, elBot;
const float PI = 3.14159265359;
void main() {
  vec3 d = normalize(vec3(v.x * tanHalf * aspect, v.y * tanHalf, 1.0));
  float cp = cos(pitch), sp = sin(pitch);
  d = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);
  float cy = cos(yaw), sy = sin(yaw);
  float north = d.z * cy - d.x * sy;
  float east = d.z * sy + d.x * cy;
  float az = atan(east, north);
  float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float t = (elTop - el) / (elTop - elBot);
  if (t < 0.0 || t > 1.0) { gl_FragColor = vec4(0.06, 0.065, 0.075, 1.0); return; }
  float g = texture2D(tex, vec2(fract(az / (2.0 * PI)), t)).r;
  gl_FragColor = vec4(vec3(g), 1.0);
}`;

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const k = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return ((Math.atan2((lon2 - lon1) * k, lat2 - lat1) * 180) / Math.PI + 360) % 360;
}

const wrap360 = (a: number) => ((a % 360) + 360) % 360;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

interface Props {
  dataset: RoverViewsDataset;
  view: RoverViewData;
  onClose: () => void;
  onNavigate: (v: RoverViewData) => void;
  /** Where the viewer looks (throttled), for the map's view cone. */
  onLook: (headingDeg: number, fovDeg: number) => void;
  /** Centre of the map inset in panel pixels (null while the panel is closed), so the map keeps the stop there. */
  onInsetCentre: (c: [number, number] | null) => void;
}

/**
 * Street-View-style rover view: drag to look around a 360° Navcam panorama, step to the previous or
 * next imaged stop along Curiosity's traverse, with the live map in an inset showing where it looks.
 */
export const RoverView: React.FC<Props> = ({ dataset, view, onClose, onNavigate, onLook, onInsetCentre }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<{ gl: WebGLRenderingContext; prog: WebGLProgram; tex: WebGLTexture; u: Record<string, WebGLUniformLocation | null> } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [look, setLook] = useState({ yaw: 180, pitch: -8, fov: 75 });
  const lookRef = useRef(look);
  lookRef.current = look;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  const ordered = useMemo(() => [...dataset.views].sort((a, b) => a.traverse_index - b.traverse_index), [dataset.views]);
  const idx = ordered.findIndex((v) => v.id === view.id);
  const prev = idx > 0 ? ordered[idx - 1] : null;
  const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;

  // --- size and the map inset ----------------------------------------------------------------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0].contentRect;
      setSize({ w: Math.max(200, Math.round(r.width)), h: Math.max(200, Math.round(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    onInsetCentre([INSET.left + INSET.width / 2, size.h - INSET.bottom - INSET.height / 2]);
  }, [size.h, onInsetCentre]);
  useEffect(() => () => onInsetCentre(null), [onInsetCentre]);

  // --- WebGL setup (once) ----------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // preserveDrawingBuffer: the view is drawn on demand, and screenshots / screen recordings must see it.
    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) {
      setGlError('This browser cannot show the panorama (WebGL is unavailable).');
      return;
    }
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    try {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const u: Record<string, WebGLUniformLocation | null> = {};
      for (const n of ['tex', 'yaw', 'pitch', 'tanHalf', 'aspect', 'elTop', 'elBot']) u[n] = gl.getUniformLocation(prog, n);
      glRef.current = { gl, prog, tex, u };
    } catch (e) {
      setGlError(`The panorama viewer could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
    return () => {
      glRef.current = null;
    };
  }, []);

  // --- draw ------------------------------------------------------------------------------------
  const texReady = useRef(false);
  const draw = useCallback(() => {
    const g = glRef.current;
    const canvas = canvasRef.current;
    if (!g || !canvas || !texReady.current) return;
    const { gl, u } = g;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(size.w * dpr);
    const h = Math.round(size.h * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    const l = lookRef.current;
    gl.uniform1i(u.tex, 0);
    gl.uniform1f(u.yaw, (l.yaw * Math.PI) / 180);
    gl.uniform1f(u.pitch, (l.pitch * Math.PI) / 180);
    gl.uniform1f(u.tanHalf, Math.tan(((l.fov / 2) * Math.PI) / 180));
    gl.uniform1f(u.aspect, w / h);
    gl.uniform1f(u.elTop, view.grid.el_top_deg);
    gl.uniform1f(u.elBot, view.grid.el_bottom_deg);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, [size, view.grid.el_top_deg, view.grid.el_bottom_deg]);

  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [draw, look, loading]);

  // --- load the panorama -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    texReady.current = false;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (cancelled) return;
      const g = glRef.current;
      if (g) {
        const { gl, tex } = g;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, img);
        texReady.current = true;
      }
      setLoading(false);
      requestAnimationFrame(draw);
    };
    img.onerror = () => {
      if (!cancelled) {
        setLoading(false);
        setError(`The panorama image could not be loaded (${view.image}).`);
      }
    };
    img.src = ROVER_BASE + view.image;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.id]);

  // --- report the look direction to the map (throttled) -----------------------------------------
  useEffect(() => {
    const t = setTimeout(() => onLook(wrap360(look.yaw), Math.min(170, horizontalFov(look.fov, size.w / size.h))), 60);
    return () => clearTimeout(t);
  }, [look, size, onLook]);

  // --- interaction -----------------------------------------------------------------------------
  const setClamped = (yaw: number, pitch: number, fov: number) =>
    setLook({ yaw: wrap360(yaw), pitch: Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch)), fov: Math.max(FOV_MIN, Math.min(FOV_MAX, fov)) });
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = look.fov / size.h; // degrees per pixel
    setClamped(d.yaw - (e.clientX - d.x) * k, d.pitch + (e.clientY - d.y) * k, look.fov);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    setClamped(look.yaw, look.pitch, look.fov * Math.exp(e.deltaY * 0.0012));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowLeft') setClamped(look.yaw - step, look.pitch, look.fov);
    else if (e.key === 'ArrowRight') setClamped(look.yaw + step, look.pitch, look.fov);
    else if (e.key === 'ArrowUp') setClamped(look.yaw, look.pitch + step, look.fov);
    else if (e.key === 'ArrowDown') setClamped(look.yaw, look.pitch - step, look.fov);
    else if (e.key === '+' || e.key === '=') setClamped(look.yaw, look.pitch, look.fov - 8);
    else if (e.key === '-') setClamped(look.yaw, look.pitch, look.fov + 8);
    else if ((e.key === '[' || e.key === 'PageUp') && prev) onNavigate(prev);
    else if ((e.key === ']' || e.key === 'PageDown') && next) onNavigate(next);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // --- screen position of a direction (for the neighbour arrows) --------------------------------
  const project = (azDeg: number, elDeg: number): [number, number] | null => {
    const a = (azDeg * Math.PI) / 180;
    const e = (elDeg * Math.PI) / 180;
    const north = Math.cos(e) * Math.cos(a);
    const east = Math.cos(e) * Math.sin(a);
    const up = Math.sin(e);
    const yaw = (look.yaw * Math.PI) / 180;
    const pitch = (look.pitch * Math.PI) / 180;
    const dz = north * Math.cos(yaw) + east * Math.sin(yaw);
    const dx = -north * Math.sin(yaw) + east * Math.cos(yaw);
    const y1 = up * Math.cos(pitch) - dz * Math.sin(pitch);
    const z1 = up * Math.sin(pitch) + dz * Math.cos(pitch);
    if (z1 <= 0.05) return null;
    const th = Math.tan(((look.fov / 2) * Math.PI) / 180);
    const sx = dx / (z1 * th * (size.w / size.h));
    const sy = y1 / (z1 * th);
    if (Math.abs(sx) > 1 || Math.abs(sy) > 1) return null;
    return [((sx + 1) / 2) * size.w, ((1 - sy) / 2) * size.h];
  };
  const neighbours = [prev, next]
    .filter((n): n is RoverViewData => !!n)
    .map((n) => ({
      view: n,
      bearing: bearingDeg(view.lat, view.lon, n.lat, n.lon),
      distance: calculateMarsDistanceMeters(view.lat, view.lon, n.lat, n.lon),
      dir: n === prev ? ('prev' as const) : ('next' as const),
    }));

  // --- compass strip ---------------------------------------------------------------------------
  const hfov = horizontalFov(look.fov, size.w / size.h);
  const ticks: Array<{ x: number; label: string | null }> = [];
  for (let a = Math.ceil((look.yaw - hfov / 2) / 15) * 15; a <= look.yaw + hfov / 2; a += 15) {
    const x = ((a - (look.yaw - hfov / 2)) / hfov) * size.w;
    const w = wrap360(a);
    ticks.push({ x, label: w % 45 === 0 ? COMPASS[w / 45] : null });
  }

  const hz = view.checks.horizon;
  const hzTone = hz.verdict === 'aligned' ? 'ok' : hz.verdict === 'offset' ? 'warn' : 'neutral';
  const hole = {
    left: INSET.left,
    top: size.h - INSET.bottom - INSET.height,
    right: INSET.left + INSET.width,
    bottom: size.h - INSET.bottom,
  };
  const clip = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${hole.left}px ${hole.top}px, ${hole.right}px ${hole.top}px, ${hole.right}px ${hole.bottom}px, ${hole.left}px ${hole.bottom}px, ${hole.left}px ${hole.top}px)`;
  const near = view.targets[0];

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="pointer-events-none absolute inset-0 z-30 outline-none"
      role="region"
      aria-label={`Rover view at ${solLabel(view.sols)}. Drag or use the arrow keys to look around; Escape closes.`}
    >
      {/* Panorama (clipped around the map inset) */}
      <div className="pointer-events-auto absolute inset-0 bg-[#0f1013]" style={{ clipPath: clip }}>
        <canvas
          ref={canvasRef}
          className={`block h-full w-full ${drag.current ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        />

        {/* Neighbour stops along the traverse, drawn where they lie */}
        {!loading &&
          neighbours.map((n) => {
            const pos = project(n.bearing, -18);
            return pos ? (
              <button
                key={n.view.id}
                type="button"
                onClick={() => onNavigate(n.view)}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded bg-black/55 px-2 py-1 text-[11px] text-white hover:bg-black/75 cursor-pointer"
                style={{ left: pos[0], top: pos[1] }}
                title={`${n.dir === 'prev' ? 'Previous' : 'Next'} rover view: ${solLabel(n.view.sols)}, ${fmtDistance(n.distance)} away`}
              >
                <span className="text-[15px] leading-none" style={{ transform: `rotate(${n.bearing - look.yaw}deg)` }} aria-hidden="true">
                  ▲
                </span>
                <span className="num whitespace-nowrap">
                  {n.dir === 'prev' ? 'Earlier' : 'Later'} stop · {fmtDistance(n.distance)}
                </span>
              </button>
            ) : null;
          })}

        {(loading || error || glError) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded border border-line bg-panel px-3 py-1.5 text-[12px] text-muted">
              {loading && !glError ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {glError ?? error ?? 'Loading panorama…'}
            </div>
          </div>
        )}

        {/* Top bar */}
        <div className="absolute inset-x-0 top-0 flex items-start gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-6 pt-2 text-white">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">
              Rover view · {solLabel(view.sols)}
              {near && (
                <span className="font-normal text-white/80">
                  {' '}
                  · {near.name}, {fmtDistance(near.distance_m)}
                </span>
              )}
            </div>
            <div className="num text-[11px] text-white/70">
              Curiosity Navcam · RMC {view.rmc} · {fmtLatLon(view.lat, view.lon)} · {view.coverage.frames} frames · {view.credit}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!prev}
              onClick={() => prev && onNavigate(prev)}
              className="flex items-center gap-0.5 rounded border border-white/30 px-1.5 py-0.5 text-[11px] hover:bg-white/10 disabled:opacity-40 cursor-pointer disabled:cursor-default"
              title={prev ? `Earlier stop on the traverse (${solLabel(prev.sols)})` : 'First rover view on the traverse'}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Earlier
            </button>
            <span className="num px-1 text-[11px] text-white/70">
              {idx + 1}/{ordered.length}
            </span>
            <button
              type="button"
              disabled={!next}
              onClick={() => next && onNavigate(next)}
              className="flex items-center gap-0.5 rounded border border-white/30 px-1.5 py-0.5 text-[11px] hover:bg-white/10 disabled:opacity-40 cursor-pointer disabled:cursor-default"
              title={next ? `Later stop on the traverse (${solLabel(next.sols)})` : 'Last rover view on the traverse'}
            >
              Later <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-1 rounded border border-white/30 p-0.5 hover:bg-white/10 cursor-pointer"
              title="Close the rover view (Esc)"
              aria-label="Close the rover view"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Compass strip */}
        <div className="pointer-events-none absolute inset-x-0 top-[50px] h-5 text-white/80" aria-hidden="true">
          {ticks.map((t) => (
            <div key={t.x} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: t.x }}>
              <span className={`w-px ${t.label ? 'h-2 bg-white/80' : 'h-1 bg-white/40'}`} />
              {t.label && <span className={`text-[10px] ${t.label === 'N' ? 'font-bold text-[#ff8a7a]' : ''}`}>{t.label}</span>}
            </div>
          ))}
          <div className="absolute left-1/2 top-0 h-3 w-0.5 -translate-x-1/2 bg-accent" />
        </div>

        {/* Zoom + heading */}
        <div className="absolute right-3 top-[78px] flex flex-col items-end gap-1.5">
          <div className="num rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white">
            Heading {Math.round(wrap360(look.yaw))}° {COMPASS[Math.round(wrap360(look.yaw) / 45) % 8]} · tilt {Math.round(look.pitch)}°
          </div>
          <div className="flex overflow-hidden rounded border border-white/30 text-white">
            <button type="button" className="p-1 hover:bg-white/10 cursor-pointer" onClick={() => setClamped(look.yaw, look.pitch, look.fov - 10)} aria-label="Zoom in" title="Zoom in (+)">
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="border-l border-white/30 p-1 hover:bg-white/10 cursor-pointer" onClick={() => setClamped(look.yaw, look.pitch, look.fov + 10)} aria-label="Zoom out" title="Zoom out (−)">
              <Minus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Info card */}
        <div className="absolute bottom-3 right-3 max-h-[45%] w-[300px] overflow-y-auto rounded border border-line bg-panel/95 p-2.5 text-[11.5px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={hzTone} title={hz.reason}>
              Horizon check: {hz.verdict}
            </StatusBadge>
            <span className="text-faint">{Math.round(view.coverage.horizon_band_azimuth_fraction * 100)}% of the horizon imaged</span>
          </div>
          <p className="mt-1.5 text-muted">
            Drag to look around, scroll to zoom. Black: not imaged at this stop. The map inset shows where you are looking.
          </p>
          <Disclosure label="How this view was made" className="mt-1.5">
            <p className="text-muted">{dataset.method}</p>
            <ul className="mt-1 list-disc pl-4 text-muted">
              {dataset.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Disclosure>
          <Disclosure label="Checks" className="mt-1">
            <KeyValues
              rows={[
                ['Horizon vs DEM', hz.verdict === 'inconclusive' ? 'inconclusive' : `${hz.azimuth_offset_deg?.toFixed(1)}° offset`],
                ['Horizon residual', hz.residual_deg != null ? `${hz.residual_deg}°` : '—'],
                ['Attitude vs waypoint yaw', `${view.checks.attitude_vs_waypoint_yaw_deg.toFixed(2)}°`],
                ['Seam difference (median)', view.checks.seams.median_abs_diff_dn != null ? `${view.checks.seams.median_abs_diff_dn} DN` : '—'],
              ]}
            />
            <p className="mt-1 text-[11px] text-faint">{hz.reason}.</p>
          </Disclosure>
          <Disclosure label={`Navcam frames used (${view.frames.length})`} className="mt-1">
            <ul className="space-y-0.5">
              {view.frames.map((f) => (
                <li key={f.imageid} className="num flex gap-2 text-[10.5px]">
                  <a href={f.page} target="_blank" rel="noreferrer" className="truncate text-accent hover:underline" title={f.imageid}>
                    {f.imageid}
                  </a>
                  <span className="ml-auto shrink-0 text-faint">sol {f.sol}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-faint">Images: {view.credit}. Links open NASA's raw-image pages (network needed).</p>
          </Disclosure>
        </div>
      </div>

      {/* Frame around the live-map inset */}
      <div
        className="pointer-events-none absolute rounded-sm border-2 border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
        style={{ left: hole.left - 2, top: hole.top - 2, width: INSET.width + 4, height: INSET.height + 4 }}
        aria-hidden="true"
      />
    </div>
  );
};

/** Horizontal field of view (deg) for a vertical one and an aspect ratio. */
function horizontalFov(vfovDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan(((vfovDeg / 2) * Math.PI) / 180) * aspect) * 180) / Math.PI;
}
