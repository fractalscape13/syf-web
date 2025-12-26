"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Point = { x: number; y: number };
type Stroke = { color: string; sizeNorm: number; points: Point[] };

export default function Home() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const withBasePath = (p: string) => `${basePath}${p.startsWith("/") ? p : `/${p}`}`;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stencilRef = useRef<HTMLImageElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const isDrawingRef = useRef(false);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    kind: "pan" | "pinch";
    startScale: number;
    startOffsetX: number;
    startOffsetY: number;
    startMidX: number;
    startMidY: number;
    startDist: number;
  } | null>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [displaySize, setDisplaySize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [stencilMeta, setStencilMeta] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [stencilDisplaySize, setStencilDisplaySize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [brushColor, setBrushColor] = useState("#111827");
  const [brushSize, setBrushSize] = useState(10);
  const [editMode, setEditMode] = useState<"move" | "draw">("move");
  const [imageTransform, setImageTransform] = useState<{
    scale: number;
    offsetX: number;
    offsetY: number;
  }>({ scale: 1, offsetX: 0, offsetY: 0 });

  const maxCanvasWidthPx = 960;
  const canvasSidePaddingPx = 48; // px-6 both sides

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  function pickImage() {
    inputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (imageUrl) URL.revokeObjectURL(imageUrl);
    const nextUrl = URL.createObjectURL(file);
    setImageUrl(nextUrl);
    setImageMeta(null);
    setDisplaySize(null);
    strokesRef.current = [];
    setImageTransform({ scale: 1, offsetX: 0, offsetY: 0 });
    setEditMode("move");

    // Allows re-selecting the same file to still trigger onChange.
    e.target.value = "";
  }

  const canExport = Boolean(
    imageUrl &&
      imageMeta &&
      stencilMeta &&
      strokesRef.current &&
      imageRef.current &&
      stencilRef.current
  );

  const exportDisabledReason = useMemo(() => {
    if (!imageUrl) return "Choose an image first";
    if (!imageMeta || !imageRef.current) return "Image is still loading";
    return "";
  }, [imageMeta, imageUrl]);

  function clampScale(next: number) {
    return Math.min(6, Math.max(0.2, next));
  }

  function zoomBy(factor: number) {
    setImageTransform((t) => ({ ...t, scale: clampScale(t.scale * factor) }));
  }

  const stageSize = useMemo(() => {
    if (!stencilMeta) return null;
    return { w: stencilMeta.width, h: stencilMeta.height };
  }, [stencilMeta]);

  function computeDisplaySize(nw: number, nh: number) {
    const maxW = Math.min(
      maxCanvasWidthPx,
      window.innerWidth - canvasSidePaddingPx
    );
    // Header scrolls with the page now; size the stage against viewport with some breathing room.
    const maxH = Math.max(240, window.innerHeight - 220);
    const scale = Math.min(maxW / nw, maxH / nh, 1);
    return {
      w: Math.max(1, Math.floor(nw * scale)),
      h: Math.max(1, Math.floor(nh * scale)),
    };
  }

  function redraw() {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    const size = stageSize;
    if (!canvas || !size) return;

    const dpr = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.floor(size.w * dpr) ||
      canvas.height !== Math.floor(size.h * dpr)
    ) {
      canvas.width = Math.floor(size.w * dpr);
      canvas.height = Math.floor(size.h * dpr);
      // Visual sizing is handled by the wrapper (w/h) + CSS (w-full/h-full).
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    if (img && imageMeta) {
      const cover = Math.max(size.w / imageMeta.width, size.h / imageMeta.height);
      const baseScale = cover * imageTransform.scale;

      ctx.save();
      ctx.translate(size.w / 2 + imageTransform.offsetX, size.h / 2 + imageTransform.offsetY);
      ctx.scale(baseScale, baseScale);
      ctx.drawImage(img, -imageMeta.width / 2, -imageMeta.height / 2);
      ctx.restore();
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const stroke of strokesRef.current) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = Math.max(1, stroke.sizeNorm * size.w);
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * size.w, stroke.points[0].y * size.h);
      for (let i = 1; i < stroke.points.length; i++) {
        const p = stroke.points[i];
        ctx.lineTo(p.x * size.w, p.y * size.h);
      }
      ctx.stroke();
    }
  }

  useEffect(() => {
    if (!imageUrl) {
      imageRef.current = null;
      setImageMeta(null);
      setDisplaySize(null);
      setImageTransform({ scale: 1, offsetX: 0, offsetY: 0 });
      return;
    }

    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      imageRef.current = img;
      setImageMeta({ width: img.naturalWidth, height: img.naturalHeight });
      setImageTransform({ scale: 1, offsetX: 0, offsetY: 0 });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      stencilRef.current = img;
      const meta = { width: img.naturalWidth, height: img.naturalHeight };
      setStencilMeta(meta);
    };
    img.src = withBasePath("/images/stealie.png");
  }, []);

  // Stage is fixed to stencil's natural pixel size: no window resize handlers.

  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageSize, imageMeta, imageUrl, imageTransform]);

  function canvasPointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const size = stageSize;
    if (!canvas || !size) return null;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function onCanvasPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!imageUrl || !stageSize) return;
    const p = canvasPointFromEvent(e);
    if (!p) return;

    const sizeNorm = brushSize / stageSize.w;
    const stroke: Stroke = { color: brushColor, sizeNorm, points: [p] };
    activeStrokeRef.current = stroke;
    strokesRef.current = [...strokesRef.current, stroke];
    isDrawingRef.current = true;

    e.currentTarget.setPointerCapture(e.pointerId);
    redraw();
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    const p = canvasPointFromEvent(e);
    const stroke = activeStrokeRef.current;
    if (!p || !stroke) return;

    stroke.points.push(p);
    redraw();
  }

  function endDrawing(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    activeStrokeRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function clearEdits() {
    strokesRef.current = [];
    redraw();
  }

  function exportImage() {
    if (!imageUrl || !imageMeta || !imageRef.current || !stencilRef.current || !stageSize) return;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = stageSize.w;
    exportCanvas.height = stageSize.h;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    const cover = Math.max(stageSize.w / imageMeta.width, stageSize.h / imageMeta.height);
    const baseScale = cover * imageTransform.scale;
    ctx.save();
    ctx.translate(stageSize.w / 2 + imageTransform.offsetX, stageSize.h / 2 + imageTransform.offsetY);
    ctx.scale(baseScale, baseScale);
    ctx.drawImage(imageRef.current, -imageMeta.width / 2, -imageMeta.height / 2);
    ctx.restore();

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const stroke of strokesRef.current) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = Math.max(1, stroke.sizeNorm * stageSize.w);
      ctx.beginPath();
      ctx.moveTo(
        stroke.points[0].x * stageSize.w,
        stroke.points[0].y * stageSize.h
      );
      for (let i = 1; i < stroke.points.length; i++) {
        const p = stroke.points[i];
        ctx.lineTo(p.x * stageSize.w, p.y * stageSize.h);
      }
      ctx.stroke();
    }

    // Match the on-screen overlay: draw stencil last so it's on top.
    ctx.drawImage(stencilRef.current, 0, 0, stageSize.w, stageSize.h);

    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "image.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  return (
    <div className="min-h-screen bg-[#D9D9D9] font-sans text-black">
      <header className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 px-6 pb-6 pt-10">
        <h1 className="text-center text-[22px] font-medium leading-7 tracking-[0.3em] text-black/90">
          STEALIE YOUR FACE
        </h1>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFileChange}
        />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={pickImage}
            className="rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-black/10 transition hover:bg-black/90 active:translate-y-px"
          >
            {imageUrl ? "Change image" : "Choose image"}
          </button>

          <button
            type="button"
            onClick={exportImage}
            disabled={!canExport}
            title={!canExport ? exportDisabledReason : "Download edited image"}
            className="rounded-full bg-transparent px-5 py-2.5 text-sm font-semibold text-black ring-1 ring-black/20 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 active:translate-y-px"
          >
            Export image
          </button>
        </div>
      </header>

      <main className="flex items-start justify-center px-6 pb-14">
        <div className="flex w-full max-w-3xl flex-col items-center gap-4">
          {imageUrl ? (
            <div className="w-full">
              <div className="mx-auto grid h-12 w-full max-w-3xl grid-cols-[auto_1fr_auto] items-center gap-3 rounded-full px-2 text-sm text-black/80">
                {/* Fixed position toggle */}
                <div className="flex items-center rounded-full ring-1 ring-black/20">
                  <button
                    type="button"
                    onClick={() => setEditMode("move")}
                    className={[
                      "rounded-full px-3 py-2 text-xs font-semibold transition",
                      editMode === "move"
                        ? "bg-black text-white"
                        : "text-black/70 hover:bg-black/5",
                    ].join(" ")}
                  >
                    Move/Zoom
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditMode("draw")}
                    className={[
                      "rounded-full px-3 py-2 text-xs font-semibold transition",
                      editMode === "draw"
                        ? "bg-black text-white"
                        : "text-black/70 hover:bg-black/5",
                    ].join(" ")}
                  >
                    Draw
                  </button>
                </div>

                {/* Fixed-height, non-jittering mode controls */}
                <div className="relative h-full min-w-0">
                  <div
                    className={[
                      "absolute inset-0 flex items-center justify-center gap-3 transition-opacity",
                      editMode === "move" ? "opacity-100" : "pointer-events-none opacity-0",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2 rounded-full px-1 py-1 ring-1 ring-black/20">
                      <button
                        type="button"
                        onClick={() => zoomBy(0.9)}
                        className="grid h-9 w-9 place-items-center rounded-full text-lg font-semibold text-black/80 transition hover:bg-black/5 active:translate-y-px"
                        aria-label="Zoom out"
                        title="Zoom out"
                      >
                        −
                      </button>
                      <span className="min-w-[56px] text-center text-xs font-semibold tracking-wide text-black/70">
                        {Math.round(imageTransform.scale * 100)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => zoomBy(1.1)}
                        className="grid h-9 w-9 place-items-center rounded-full text-lg font-semibold text-black/80 transition hover:bg-black/5 active:translate-y-px"
                        aria-label="Zoom in"
                        title="Zoom in"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div
                    className={[
                      "absolute inset-0 flex items-center justify-center gap-3 transition-opacity",
                      editMode === "draw" ? "opacity-100" : "pointer-events-none opacity-0",
                    ].join(" ")}
                  >
                    <label className="flex items-center gap-2">
                      <span>Brush</span>
                      <input
                        type="range"
                        min={2}
                        max={40}
                        value={brushSize}
                        onChange={(e) => setBrushSize(Number(e.target.value))}
                        className="w-36"
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <span>Color</span>
                      <input
                        type="color"
                        value={brushColor}
                        onChange={(e) => setBrushColor(e.target.value)}
                        className="h-8 w-10 rounded-md border border-black/20 bg-transparent p-1"
                      />
                    </label>
                  </div>
                </div>

                {/* Fixed position action */}
                <button
                  type="button"
                  onClick={clearEdits}
                  disabled={!imageUrl}
                  className={[
                    "rounded-full px-4 py-2 text-xs font-semibold text-black ring-1 ring-black/20 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50",
                    editMode === "move" ? "invisible" : "visible",
                  ].join(" ")}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}

          {(() => {
            if (!stageSize) return null;
            const stageDisplayWidthPx = 360;
            return (
              <div className="flex w-full justify-center">
                <div
                  className="relative w-full overflow-hidden"
                  style={{
                    width: stageDisplayWidthPx,
                    maxWidth: "100%",
                    aspectRatio: `${stageSize.w} / ${stageSize.h}`,
                  }}
                >
                {imageUrl ? (
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 h-full w-full touch-none bg-black/5"
                    onPointerDown={(e) => {
                      if (editMode === "draw") {
                        onCanvasPointerDown(e);
                        return;
                      }
                      if (editMode !== "move") return;
                      if (!stageSize) return;

                      e.currentTarget.setPointerCapture(e.pointerId);
                      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

                      const pts = Array.from(pointersRef.current.values());
                      if (pts.length === 1) {
                        gestureRef.current = {
                          kind: "pan",
                          startScale: imageTransform.scale,
                          startOffsetX: imageTransform.offsetX,
                          startOffsetY: imageTransform.offsetY,
                          startMidX: pts[0].x,
                          startMidY: pts[0].y,
                          startDist: 0,
                        };
                      } else if (pts.length >= 2) {
                        const a = pts[0];
                        const b = pts[1];
                        const midX = (a.x + b.x) / 2;
                        const midY = (a.y + b.y) / 2;
                        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                        gestureRef.current = {
                          kind: "pinch",
                          startScale: imageTransform.scale,
                          startOffsetX: imageTransform.offsetX,
                          startOffsetY: imageTransform.offsetY,
                          startMidX: midX,
                          startMidY: midY,
                          startDist: dist,
                        };
                      }
                    }}
                    onPointerMove={(e) => {
                      if (editMode === "draw") {
                        onCanvasPointerMove(e);
                        return;
                      }
                      if (editMode !== "move") return;
                      const g = gestureRef.current;
                      if (!g) return;

                      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                      const pts = Array.from(pointersRef.current.values());
                      if (pts.length === 0) return;

                      if (pts.length === 1 && g.kind === "pan") {
                        const p = pts[0];
                        const dx = p.x - g.startMidX;
                        const dy = p.y - g.startMidY;
                        setImageTransform({
                          scale: g.startScale,
                          offsetX: g.startOffsetX + dx,
                          offsetY: g.startOffsetY + dy,
                        });
                        return;
                      }

                      if (pts.length >= 2) {
                        const a = pts[0];
                        const b = pts[1];
                        const midX = (a.x + b.x) / 2;
                        const midY = (a.y + b.y) / 2;
                        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                        const scale = Math.min(
                          6,
                          Math.max(0.2, g.startScale * (dist / g.startDist)),
                        );
                        const dx = midX - g.startMidX;
                        const dy = midY - g.startMidY;
                        setImageTransform({
                          scale,
                          offsetX: g.startOffsetX + dx,
                          offsetY: g.startOffsetY + dy,
                        });
                      }
                    }}
                    onPointerUp={(e) => {
                      endDrawing(e);
                      pointersRef.current.delete(e.pointerId);
                      gestureRef.current = null;
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {
                        // ignore
                      }
                    }}
                    onPointerCancel={(e) => {
                      endDrawing(e);
                      pointersRef.current.delete(e.pointerId);
                      gestureRef.current = null;
                    }}
                    onPointerLeave={(e) => {
                      endDrawing(e);
                      pointersRef.current.delete(e.pointerId);
                      gestureRef.current = null;
                    }}
                    onWheel={(e) => {
                      if (editMode !== "move") return;
                      e.preventDefault();
                      const next =
                        e.deltaY < 0
                          ? imageTransform.scale * 1.06
                          : imageTransform.scale * 0.94;
                      setImageTransform((t) => ({
                        ...t,
                        scale: clampScale(next),
                      }));
                    }}
                  />
                ) : (
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage:
                        "linear-gradient(135deg, rgba(0,0,0,.06) 0%, rgba(0,0,0,.02) 50%, rgba(0,0,0,.06) 100%)",
                    }}
                  />
                )}

                {/* Stencil overlay */}
                <img
                  src={withBasePath("/images/stealie.png")}
                  alt="Stealie stencil"
                  className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                  draggable={false}
                />
                </div>
              </div>
            );
          })()}
        </div>
      </main>
    </div>
  );
}
