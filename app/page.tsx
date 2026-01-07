"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Point = { x: number; y: number };
type Stroke = { color: string; sizeNorm: number; points: Point[] };

export default function Home() {
  // Get basePath - Next.js sets NEXT_PUBLIC_BASE_PATH at build time
  // For static exports with basePath, we need to manually add it to asset paths
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const withBasePath = (p: string) => {
    if (p.startsWith("http://") || p.startsWith("https://") || p.startsWith("data:") || p.startsWith("blob:")) {
      return p;
    }
    const cleanPath = p.startsWith("/") ? p : `/${p}`;
    return basePath ? `${basePath}${cleanPath}` : cleanPath;
  };

  const inputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stencilRef = useRef<HTMLImageElement | null>(null);
  const processedStencilRef = useRef<HTMLCanvasElement | null>(null);
  const stencilMaskRef = useRef<HTMLCanvasElement | null>(null);
  const [processedStencilUrl, setProcessedStencilUrl] = useState<string | null>(null);
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
  const redrawRequestRef = useRef<number | null>(null);
  const transformUpdateRequestRef = useRef<number | null>(null);
  const pendingTransformRef = useRef<{ scale: number; offsetX: number; offsetY: number } | null>(null);

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
  const [exportBackgroundType, setExportBackgroundType] = useState<"color" | "transparent">("color");
  const [exportBackgroundColor, setExportBackgroundColor] = useState("#D9D9D9");
  const [imageTransform, setImageTransform] = useState<{
    scale: number;
    offsetX: number;
    offsetY: number;
  }>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [mounted, setMounted] = useState(false);

  const maxCanvasWidthPx = 960;
  const canvasSidePaddingPx = 48; // px-6 both sides

  // Ensure component is mounted before rendering browser-dependent content
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      if (processedStencilUrl) URL.revokeObjectURL(processedStencilUrl);
      // Cleanup pending redraw request
      if (redrawRequestRef.current !== null) {
        cancelAnimationFrame(redrawRequestRef.current);
        redrawRequestRef.current = null;
      }
      // Cleanup pending transform update request
      if (transformUpdateRequestRef.current !== null) {
        cancelAnimationFrame(transformUpdateRequestRef.current);
        transformUpdateRequestRef.current = null;
      }
    };
  }, [imageUrl, processedStencilUrl]);

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
      (stencilRef.current || processedStencilRef.current)
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
    // Cancel any pending redraw
    if (redrawRequestRef.current !== null) {
      cancelAnimationFrame(redrawRequestRef.current);
      redrawRequestRef.current = null;
    }
    
    const canvas = canvasRef.current;
    const img = imageRef.current;
    const size = stageSize;
    if (!canvas || !size) return;
    
    // Guard: ensure size is valid
    if (size.w <= 0 || size.h <= 0 || !Number.isFinite(size.w) || !Number.isFinite(size.h)) {
      return;
    }

    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const canvasWidth = Math.floor(size.w * dpr);
    const canvasHeight = Math.floor(size.h * dpr);
    
    // Guard: ensure canvas dimensions are valid
    if (canvasWidth <= 0 || canvasHeight <= 0 || !Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) {
      return;
    }
    
    if (
      canvas.width !== canvasWidth ||
      canvas.height !== canvasHeight
    ) {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      // Visual sizing is handled by the wrapper (w/h) + CSS (w-full/h-full).
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      // Reset transform and clear
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      
      // Draw background first (before any transforms)
      if (exportBackgroundType === "color") {
        ctx.fillStyle = exportBackgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        // Transparent - draw checkerboard pattern to indicate transparency
        // Draw checkerboard at device pixel resolution
        const tileSize = 12 * dpr;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#e5e5e5";
        for (let y = 0; y < canvas.height; y += tileSize) {
          for (let x = 0; x < canvas.width; x += tileSize) {
            if ((x / tileSize + y / tileSize) % 2 === 0) {
              ctx.fillRect(x, y, tileSize, tileSize);
            }
          }
        }
      }

      // Set up DPR transform for drawing user content
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Draw image and strokes to a temporary canvas, then mask and composite onto background
    const maskToUse = stencilMaskRef.current || stencilRef.current;
    if (img && imageMeta && maskToUse) {
      // Guard: ensure image is fully loaded
      if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
        return;
      }
      
      // Guard: ensure mask is valid (for images, check if loaded; for canvas, check if valid)
      const isMaskImage = maskToUse instanceof HTMLImageElement;
      const isMaskCanvas = maskToUse instanceof HTMLCanvasElement;
      if (isMaskImage && (!maskToUse.complete || maskToUse.naturalWidth === 0 || maskToUse.naturalHeight === 0)) {
        return;
      }
      if (isMaskCanvas && (maskToUse.width === 0 || maskToUse.height === 0)) {
        return;
      }
      
      // Create temporary canvas for image and strokes
      try {
        const tempCanvas = document.createElement("canvas");
        const tempWidth = Math.floor(size.w * dpr);
        const tempHeight = Math.floor(size.h * dpr);
        
        // Guard: ensure temp canvas dimensions are valid
        if (tempWidth <= 0 || tempHeight <= 0 || !Number.isFinite(tempWidth) || !Number.isFinite(tempHeight)) {
          return;
        }
        
        tempCanvas.width = tempWidth;
        tempCanvas.height = tempHeight;
        const tempCtx = tempCanvas.getContext("2d");
        if (tempCtx) {
        tempCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Draw image
        const cover = Math.max(size.w / imageMeta.width, size.h / imageMeta.height);
        // Guard: ensure transform values are valid
        const scale = Number.isFinite(imageTransform.scale) ? imageTransform.scale : 1;
        const offsetX = Number.isFinite(imageTransform.offsetX) ? imageTransform.offsetX : 0;
        const offsetY = Number.isFinite(imageTransform.offsetY) ? imageTransform.offsetY : 0;
        const baseScale = cover * scale;
        if (!Number.isFinite(baseScale)) return;
        
        tempCtx.save();
        tempCtx.translate(size.w / 2 + offsetX, size.h / 2 + offsetY);
        tempCtx.scale(baseScale, baseScale);
        tempCtx.drawImage(img, -imageMeta.width / 2, -imageMeta.height / 2);
        tempCtx.restore();

        // Draw strokes
        tempCtx.lineCap = "round";
        tempCtx.lineJoin = "round";
        for (const stroke of strokesRef.current) {
          if (stroke.points.length < 2) continue;
          tempCtx.strokeStyle = stroke.color;
          tempCtx.lineWidth = Math.max(1, stroke.sizeNorm * size.w);
          tempCtx.beginPath();
          tempCtx.moveTo(stroke.points[0].x * size.w, stroke.points[0].y * size.h);
          for (let i = 1; i < stroke.points.length; i++) {
            const p = stroke.points[i];
            tempCtx.lineTo(p.x * size.w, p.y * size.h);
          }
          tempCtx.stroke();
        }

        // Mask the temporary canvas to only show inside stencil
        tempCtx.save();
        tempCtx.globalCompositeOperation = "destination-in";
        // Draw mask at device pixel resolution
        tempCtx.setTransform(1, 0, 0, 1, 0, 0);
        // Scale mask to match temp canvas size (which is already at DPR resolution)
        tempCtx.drawImage(maskToUse, 0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.restore();

        // Composite the masked image/strokes onto the main canvas
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.restore();
        }
      } catch (error) {
        console.error("Error drawing to temporary canvas:", error);
        return;
      }
    } else if (img && imageMeta) {
      // Guard: ensure image is fully loaded
      if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
        return;
      }
      // Fallback if no mask: draw image and strokes normally
      const cover = Math.max(size.w / imageMeta.width, size.h / imageMeta.height);
      // Guard: ensure transform values are valid
      const scale = Number.isFinite(imageTransform.scale) ? imageTransform.scale : 1;
      const offsetX = Number.isFinite(imageTransform.offsetX) ? imageTransform.offsetX : 0;
      const offsetY = Number.isFinite(imageTransform.offsetY) ? imageTransform.offsetY : 0;
      const baseScale = cover * scale;
      if (!Number.isFinite(baseScale)) return;
      
      ctx.save();
      ctx.translate(size.w / 2 + offsetX, size.h / 2 + offsetY);
      ctx.scale(baseScale, baseScale);
      ctx.drawImage(img, -imageMeta.width / 2, -imageMeta.height / 2);
      ctx.restore();

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
    } catch (error) {
      console.error("Error in redraw function:", error);
      // Don't throw - just log the error to prevent app crash
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
      // Guard: ensure image loaded successfully
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        imageRef.current = img;
        setImageMeta({ width: img.naturalWidth, height: img.naturalHeight });
        setImageTransform({ scale: 1, offsetX: 0, offsetY: 0 });
      }
    };
    img.onerror = () => {
      console.error("Failed to load image");
      imageRef.current = null;
      setImageMeta(null);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    const img = new Image();
    img.decoding = "async";
    const stencilPath = withBasePath("/images/stealie.png");
    img.onload = () => {
      stencilRef.current = img;
      const meta = { width: img.naturalWidth, height: img.naturalHeight };
      setStencilMeta(meta);

      // Process stencil to make grey background transparent
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Make grey background transparent (approximately #D9D9D9 or similar grey)
        // Check for pixels that are close to grey (similar R, G, B values)
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Check if pixel is grey (R, G, B are similar) and in the grey range
          const isGrey = Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && Math.abs(r - b) < 30;
          const greyValue = (r + g + b) / 3;
          // If it's a light grey (between ~200-230), make it transparent
          if (isGrey && greyValue > 200 && greyValue < 240) {
            data[i + 3] = 0; // Set alpha to 0 (transparent)
          }
        }
        ctx.putImageData(imageData, 0, 0);
        processedStencilRef.current = canvas;
        // Create data URL for the overlay image
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            setProcessedStencilUrl(url);
          }
        }, "image/png");

        // Create a mask for clipping: black parts = opaque, grey parts = transparent
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = img.naturalWidth;
        maskCanvas.height = img.naturalHeight;
        const maskCtx = maskCanvas.getContext("2d");
        if (maskCtx) {
          maskCtx.drawImage(img, 0, 0);
          const maskImageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
          const maskData = maskImageData.data;

          for (let i = 0; i < maskData.length; i += 4) {
            const r = maskData[i];
            const g = maskData[i + 1];
            const b = maskData[i + 2];
            // Check if pixel is grey (similar R, G, B values)
            const isGrey = Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && Math.abs(r - b) < 30;
            const greyValue = (r + g + b) / 3;
            // If it's a light grey (background), make it transparent
            // Otherwise (black parts), make it fully opaque white for the mask
            if (isGrey && greyValue > 200 && greyValue < 240) {
              maskData[i + 3] = 0; // Transparent
            } else {
              // Black parts: make fully opaque (white in mask means "keep")
              maskData[i] = 255;
              maskData[i + 1] = 255;
              maskData[i + 2] = 255;
              maskData[i + 3] = 255;
            }
          }
          maskCtx.putImageData(maskImageData, 0, 0);
          stencilMaskRef.current = maskCanvas;
        }
      }
    };
    img.onerror = (e) => {
      console.error("Failed to load stencil image. Path:", stencilPath, "Error:", e);
      // Try to help debug - log the actual basePath value
      console.error("basePath value:", basePath);
      console.error("NEXT_PUBLIC_BASE_PATH:", process.env.NEXT_PUBLIC_BASE_PATH);
    };
    img.src = stencilPath;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // basePath is constant from env var, so empty deps is fine

  // Stage is fixed to stencil's natural pixel size: no window resize handlers.

  useEffect(() => {
    if (mounted) {
      redraw();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, stageSize, imageMeta, imageUrl, imageTransform, exportBackgroundType, exportBackgroundColor]);

  function canvasPointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const size = stageSize;
    if (!canvas || !size) return null;

    try {
      const rect = canvas.getBoundingClientRect();
      // Guard: ensure rect is valid
      if (!rect || rect.width <= 0 || rect.height <= 0 || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
        return null;
      }
      
      // Guard: ensure clientX/Y are valid
      if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) {
        return null;
      }
      
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

      return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    } catch (error) {
      console.error("Error in canvasPointFromEvent:", error);
      return null;
    }
  }

  function onCanvasPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    try {
      if (!imageUrl || !stageSize) return;
      
      // Guard: ensure stageSize is valid
      if (stageSize.w <= 0 || !Number.isFinite(stageSize.w)) return;
      
      const p = canvasPointFromEvent(e);
      if (!p) return;

      const sizeNorm = brushSize / stageSize.w;
      if (!Number.isFinite(sizeNorm)) return;
      
      const stroke: Stroke = { color: brushColor, sizeNorm, points: [p] };
      activeStrokeRef.current = stroke;
      strokesRef.current = [...strokesRef.current, stroke];
      isDrawingRef.current = true;

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (error) {
        // Pointer capture may fail on some mobile browsers, continue anyway
        console.warn("Pointer capture failed:", error);
      }
      
      redraw();
    } catch (error) {
      console.error("Error in onCanvasPointerDown:", error);
    }
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    try {
      if (!isDrawingRef.current) return;
      const p = canvasPointFromEvent(e);
      const stroke = activeStrokeRef.current;
      if (!p || !stroke) return;

      // Guard: ensure point is valid
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;

      stroke.points.push(p);
      
      // Throttle redraws using requestAnimationFrame
      if (redrawRequestRef.current === null) {
        redrawRequestRef.current = requestAnimationFrame(() => {
          redrawRequestRef.current = null;
          redraw();
        });
      }
    } catch (error) {
      console.error("Error in onCanvasPointerMove:", error);
    }
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
    if (!imageUrl || !imageMeta || !imageRef.current || !stageSize) return;
    if (!stencilRef.current && !processedStencilRef.current) return;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = stageSize.w;
    exportCanvas.height = stageSize.h;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    // Draw background
    if (exportBackgroundType === "color") {
      ctx.fillStyle = exportBackgroundColor;
      ctx.fillRect(0, 0, stageSize.w, stageSize.h);
    }
    // If transparent, leave canvas transparent (no fill)

    // Draw image and strokes to a temporary canvas, then mask and composite onto background
    const maskToUse = stencilMaskRef.current || stencilRef.current;
    if (maskToUse) {
      // Create temporary canvas for image and strokes
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = stageSize.w;
      tempCanvas.height = stageSize.h;
      const tempCtx = tempCanvas.getContext("2d");
      if (tempCtx) {
        // Draw image
        const cover = Math.max(stageSize.w / imageMeta.width, stageSize.h / imageMeta.height);
        const baseScale = cover * imageTransform.scale;
        tempCtx.save();
        tempCtx.translate(stageSize.w / 2 + imageTransform.offsetX, stageSize.h / 2 + imageTransform.offsetY);
        tempCtx.scale(baseScale, baseScale);
        tempCtx.drawImage(imageRef.current, -imageMeta.width / 2, -imageMeta.height / 2);
        tempCtx.restore();

        // Draw strokes
        tempCtx.lineCap = "round";
        tempCtx.lineJoin = "round";
        for (const stroke of strokesRef.current) {
          if (stroke.points.length < 2) continue;
          tempCtx.strokeStyle = stroke.color;
          tempCtx.lineWidth = Math.max(1, stroke.sizeNorm * stageSize.w);
          tempCtx.beginPath();
          tempCtx.moveTo(
            stroke.points[0].x * stageSize.w,
            stroke.points[0].y * stageSize.h
          );
          for (let i = 1; i < stroke.points.length; i++) {
            const p = stroke.points[i];
            tempCtx.lineTo(p.x * stageSize.w, p.y * stageSize.h);
          }
          tempCtx.stroke();
        }

        // Mask the temporary canvas to only show inside stencil
        tempCtx.save();
        tempCtx.globalCompositeOperation = "destination-in";
        tempCtx.drawImage(maskToUse, 0, 0, stageSize.w, stageSize.h);
        tempCtx.restore();

        // Composite the masked image/strokes onto the main canvas (with background)
        ctx.drawImage(tempCanvas, 0, 0);
      }
    } else {
      // Fallback if no mask: draw image and strokes normally
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
    }

    // Draw stencil outline on top (the black lines of the skull)
    // Use processed stencil so background shows through, or original if processed not available
    const stencilToDraw = processedStencilRef.current || stencilRef.current;
    if (stencilToDraw) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(stencilToDraw, 0, 0, stageSize.w, stageSize.h);
      ctx.restore();
    }

    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "stealie-image.png";
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

        <div className="flex flex-col items-center gap-3">
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

          {imageUrl && (
            <div className="flex items-center gap-2 rounded-full px-2 py-1.5 ring-1 ring-black/20">
              <span className="px-2 text-xs font-semibold text-black/70">Background:</span>
              <div className="flex items-center rounded-full ring-1 ring-black/10">
                <button
                  type="button"
                  onClick={() => setExportBackgroundType("color")}
                  className={[
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    exportBackgroundType === "color"
                      ? "bg-black text-white"
                      : "text-black/70 hover:bg-black/5",
                  ].join(" ")}
                >
                  Color
                </button>
                <button
                  type="button"
                  onClick={() => setExportBackgroundType("transparent")}
                  className={[
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    exportBackgroundType === "transparent"
                      ? "bg-black text-white"
                      : "text-black/70 hover:bg-black/5",
                  ].join(" ")}
                >
                  Transparent
                </button>
              </div>
              {exportBackgroundType === "color" && (
                <label className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={exportBackgroundColor}
                    onChange={(e) => setExportBackgroundColor(e.target.value)}
                    className="h-7 w-9 rounded-md border border-black/20 bg-transparent p-0.5 cursor-pointer"
                    title="Background color"
                  />
                </label>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="flex items-start justify-center px-6 pb-14">
        <div className="flex w-full max-w-3xl flex-col items-center gap-4">
          {imageUrl ? (
            <div className="w-full">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-full px-2 py-2 text-sm text-black/80 md:grid md:h-12 md:grid-cols-[auto_1fr_auto] md:items-center md:py-0">
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
                <div className="relative min-h-12 min-w-0 md:h-full">
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
                    className="absolute inset-0 h-full w-full touch-none"
                    onPointerDown={(e) => {
                      try {
                        if (editMode === "draw") {
                          onCanvasPointerDown(e);
                          return;
                        }
                        if (editMode !== "move") return;
                        if (!stageSize) return;

                        // Guard: ensure clientX/Y are valid
                        if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;

                        try {
                          e.currentTarget.setPointerCapture(e.pointerId);
                        } catch (error) {
                          // Pointer capture may fail on some mobile browsers, continue anyway
                          console.warn("Pointer capture failed:", error);
                        }
                        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

                      const pts = Array.from(pointersRef.current.values());
                      if (pts.length === 1) {
                        const p = pts[0];
                        // Guard: ensure point and transform values are valid
                        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
                        if (!Number.isFinite(imageTransform.scale) || 
                            !Number.isFinite(imageTransform.offsetX) || 
                            !Number.isFinite(imageTransform.offsetY)) return;
                        
                        gestureRef.current = {
                          kind: "pan",
                          startScale: imageTransform.scale,
                          startOffsetX: imageTransform.offsetX,
                          startOffsetY: imageTransform.offsetY,
                          startMidX: p.x,
                          startMidY: p.y,
                          startDist: 0,
                        };
                      } else if (pts.length >= 2) {
                        const a = pts[0];
                        const b = pts[1];
                        
                        // Guard: ensure both points are valid
                        if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || 
                            !Number.isFinite(b.x) || !Number.isFinite(b.y)) return;
                        if (!Number.isFinite(imageTransform.scale) || 
                            !Number.isFinite(imageTransform.offsetX) || 
                            !Number.isFinite(imageTransform.offsetY)) return;
                        
                        const midX = (a.x + b.x) / 2;
                        const midY = (a.y + b.y) / 2;
                        let dist = Math.hypot(a.x - b.x, a.y - b.y);
                        
                        // Guard: ensure distance is valid and not zero
                        if (!Number.isFinite(dist) || dist <= 0) {
                          dist = 1; // Fallback to prevent division by zero
                        }
                        
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
                      } catch (error) {
                        console.error("Error in onPointerDown:", error);
                      }
                    }}
                    onPointerMove={(e) => {
                      try {
                        if (editMode === "draw") {
                          onCanvasPointerMove(e);
                          return;
                        }
                        if (editMode !== "move") return;
                        const g = gestureRef.current;
                        if (!g) return;

                      // Guard: ensure clientX/Y are valid
                      if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
                      
                      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                      const pts = Array.from(pointersRef.current.values());
                      if (pts.length === 0) return;

                      if (pts.length === 1 && g.kind === "pan") {
                        const p = pts[0];
                        // Guard: ensure point values are valid
                        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
                        if (!Number.isFinite(g.startMidX) || !Number.isFinite(g.startMidY)) return;
                        
                        const dx = p.x - g.startMidX;
                        const dy = p.y - g.startMidY;
                        
                        // Guard: ensure calculations are valid
                        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
                        if (!Number.isFinite(g.startScale)) return;
                        
                        const newOffsetX = g.startOffsetX + dx;
                        const newOffsetY = g.startOffsetY + dy;
                        
                        // Guard: ensure offset values are reasonable (prevent extreme values)
                        if (!Number.isFinite(newOffsetX) || !Number.isFinite(newOffsetY)) return;
                        if (Math.abs(newOffsetX) > 10000 || Math.abs(newOffsetY) > 10000) return;
                        
                        // Store pending transform and throttle state updates
                        pendingTransformRef.current = {
                          scale: g.startScale,
                          offsetX: newOffsetX,
                          offsetY: newOffsetY,
                        };
                        
                        // Throttle state updates using requestAnimationFrame
                        if (transformUpdateRequestRef.current === null) {
                          transformUpdateRequestRef.current = requestAnimationFrame(() => {
                            if (pendingTransformRef.current) {
                              setImageTransform(pendingTransformRef.current);
                              pendingTransformRef.current = null;
                            }
                            transformUpdateRequestRef.current = null;
                          });
                        }
                        return;
                      }

                      if (pts.length >= 2) {
                        const a = pts[0];
                        const b = pts[1];
                        
                        // Guard: ensure both points are valid
                        if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || 
                            !Number.isFinite(b.x) || !Number.isFinite(b.y)) return;
                        
                        const midX = (a.x + b.x) / 2;
                        const midY = (a.y + b.y) / 2;
                        const dist = Math.hypot(a.x - b.x, a.y - b.y);
                        
                        // Guard: prevent division by zero and ensure values are valid
                        if (!Number.isFinite(dist) || dist <= 0) return;
                        if (!Number.isFinite(g.startDist) || g.startDist <= 0) return;
                        if (!Number.isFinite(g.startScale)) return;
                        
                        const scaleRatio = dist / g.startDist;
                        if (!Number.isFinite(scaleRatio)) return;
                        
                        const scale = Math.min(
                          6,
                          Math.max(0.2, g.startScale * scaleRatio),
                        );
                        const dx = midX - g.startMidX;
                        const dy = midY - g.startMidY;
                        
                        // Guard: ensure final values are valid
                        if (!Number.isFinite(scale) || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
                        
                        const newOffsetX = g.startOffsetX + dx;
                        const newOffsetY = g.startOffsetY + dy;
                        
                        // Guard: ensure offset values are reasonable (prevent extreme values)
                        if (!Number.isFinite(newOffsetX) || !Number.isFinite(newOffsetY)) return;
                        if (Math.abs(newOffsetX) > 10000 || Math.abs(newOffsetY) > 10000) return;
                        
                        // Store pending transform and throttle state updates
                        pendingTransformRef.current = {
                          scale,
                          offsetX: newOffsetX,
                          offsetY: newOffsetY,
                        };
                        
                        // Throttle state updates using requestAnimationFrame
                        if (transformUpdateRequestRef.current === null) {
                          transformUpdateRequestRef.current = requestAnimationFrame(() => {
                            if (pendingTransformRef.current) {
                              setImageTransform(pendingTransformRef.current);
                              pendingTransformRef.current = null;
                            }
                            transformUpdateRequestRef.current = null;
                          });
                        }
                      }
                      } catch (error) {
                        console.error("Error in onPointerMove:", error);
                      }
                    }}
                    onPointerUp={(e) => {
                      try {
                        endDrawing(e);
                        pointersRef.current.delete(e.pointerId);
                        
                        // Flush any pending transform update before clearing gesture
                        if (pendingTransformRef.current) {
                          setImageTransform(pendingTransformRef.current);
                          pendingTransformRef.current = null;
                        }
                        if (transformUpdateRequestRef.current !== null) {
                          cancelAnimationFrame(transformUpdateRequestRef.current);
                          transformUpdateRequestRef.current = null;
                        }
                        
                        gestureRef.current = null;
                        try {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        } catch {
                          // ignore
                        }
                      } catch (error) {
                        console.error("Error in onPointerUp:", error);
                      }
                    }}
                    onPointerCancel={(e) => {
                      try {
                        endDrawing(e);
                        pointersRef.current.delete(e.pointerId);
                        
                        // Flush any pending transform update before clearing gesture
                        if (pendingTransformRef.current) {
                          setImageTransform(pendingTransformRef.current);
                          pendingTransformRef.current = null;
                        }
                        if (transformUpdateRequestRef.current !== null) {
                          cancelAnimationFrame(transformUpdateRequestRef.current);
                          transformUpdateRequestRef.current = null;
                        }
                        
                        gestureRef.current = null;
                      } catch (error) {
                        console.error("Error in onPointerCancel:", error);
                      }
                    }}
                    onPointerLeave={(e) => {
                      try {
                        endDrawing(e);
                        pointersRef.current.delete(e.pointerId);
                        
                        // Flush any pending transform update before clearing gesture
                        if (pendingTransformRef.current) {
                          setImageTransform(pendingTransformRef.current);
                          pendingTransformRef.current = null;
                        }
                        if (transformUpdateRequestRef.current !== null) {
                          cancelAnimationFrame(transformUpdateRequestRef.current);
                          transformUpdateRequestRef.current = null;
                        }
                        
                        gestureRef.current = null;
                      } catch (error) {
                        console.error("Error in onPointerLeave:", error);
                      }
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
                      backgroundColor: "#D9D9D9",
                    }}
                  />
                )}

                {/* Stencil overlay */}
                <img
                  src={processedStencilUrl || withBasePath("/images/stealie.png")}
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
