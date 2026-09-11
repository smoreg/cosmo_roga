import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface Viewport {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export interface PanZoom {
  /** A callback ref: hand it to the <svg>. */
  readonly attach: (node: SVGSVGElement | null) => void;
  readonly transform: string;
  readonly scale: number;
  readonly dragging: boolean;
  /** True while a drag is in flight, so a pan does not land as a click. */
  readonly wasDragged: () => boolean;
  readonly onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void;
  readonly reset: () => void;
  readonly zoomBy: (factor: number) => void;
  /** Client pixels to the content's own units, back through the transform. */
  readonly toContent: (clientX: number, clientY: number) => { x: number; y: number };
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 8;
/** Past this many pixels a press is a pan, not a click on a hex. */
const DRAG_SLOP = 4;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Client pixels to the units a viewBox is drawn in.
 *
 * An <svg> with a viewBox and no preserveAspectRatio uses `xMidYMid meet`: the
 * content is scaled to *fit* and centred, leaving a margin on whichever axis
 * has room to spare. Treating it as a stretch — which is the obvious thing to
 * write — puts every pointer reading out by that margin, and the error grows
 * with the mismatch between the box and the element.
 */
export function clientToUser(
  viewBox: Box,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (rect.width === 0 || rect.height === 0 || viewBox.width === 0 || viewBox.height === 0) {
    return { x: clientX, y: clientY };
  }
  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  const marginX = (rect.width - viewBox.width * scale) / 2;
  const marginY = (rect.height - viewBox.height * scale) / 2;
  return {
    x: viewBox.x + (clientX - rect.left - marginX) / scale,
    y: viewBox.y + (clientY - rect.top - marginY) / scale,
  };
}

/**
 * Pan and zoom over a fixed viewBox.
 *
 * The SVG keeps the deck's own feet as its coordinate system and everything
 * drawable sits inside one transformed group, so nothing downstream has to
 * know the view has moved — a hex is still at the same place in ship feet.
 */
export function usePanZoom(
  contentWidth: number,
  contentHeight: number,
  originX = 0,
  originY = 0,
): PanZoom {
  const [node, setNode] = useState<SVGSVGElement | null>(null);
  const nodeRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<Viewport>({ scale: 1, x: 0, y: 0 });

  const attach = useCallback(function take(next: SVGSVGElement | null): void {
    nodeRef.current = next;
    setNode(next);
  }, []);
  const [dragging, setDragging] = useState(false);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);
  const pinchDistance = useRef<number | null>(null);

  /** Client pixels to the units the viewBox is drawn in. */
  const toUser = useCallback(
    function convert(clientX: number, clientY: number) {
      const svg = nodeRef.current;
      if (svg === null) return { x: clientX, y: clientY };
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return { x: clientX, y: clientY };
      return clientToUser(
        { x: originX, y: originY, width: contentWidth, height: contentHeight },
        rect,
        clientX,
        clientY,
      );
    },
    [contentWidth, contentHeight, originX, originY],
  );

  /** Zoom about a fixed point, so what is under the pointer stays under it. */
  const zoomAbout = useCallback(function zoom(factor: number, atX: number, atY: number) {
    setView(function next(current) {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = scale / current.scale;
      return {
        scale,
        x: atX - (atX - current.x) * ratio,
        y: atY - (atY - current.y) * ratio,
      };
    });
  }, []);

  /* Wheel has to be a native listener: React attaches passively, and a passive
     handler cannot stop the page scrolling under the map. */
  useEffect(
    function bindWheel() {
      if (node === null) return;
      function onWheel(event: WheelEvent) {
        event.preventDefault();
        const at = toUser(event.clientX, event.clientY);
        zoomAbout(Math.exp(-event.deltaY * 0.0015), at.x, at.y);
      }
      node.addEventListener("wheel", onWheel, { passive: false });
      return function unbind() {
        node.removeEventListener("wheel", onWheel);
      };
    },
    [node, toUser, zoomAbout],
  );

  const onPointerDown = useCallback(function down(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragged.current = false;
    if (pointers.current.size === 1) setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    function move(event: ReactPointerEvent<SVGSVGElement>) {
      const previous = pointers.current.get(event.pointerId);
      if (previous === undefined) return;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      const touches = [...pointers.current.values()];
      if (touches.length >= 2) {
        const [first, second] = touches;
        if (first === undefined || second === undefined) return;
        const spread = Math.hypot(first.x - second.x, first.y - second.y);
        const last = pinchDistance.current;
        pinchDistance.current = spread;
        if (last !== null && last > 0) {
          const middle = toUser((first.x + second.x) / 2, (first.y + second.y) / 2);
          zoomAbout(spread / last, middle.x, middle.y);
        }
        dragged.current = true;
        return;
      }

      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) dragged.current = true;

      const rect = nodeRef.current?.getBoundingClientRect();
      if (rect === undefined || rect.width === 0) return;
      const perPixelX = contentWidth / rect.width;
      const perPixelY = contentHeight / rect.height;
      setView(function pan(current) {
        return { ...current, x: current.x + dx * perPixelX, y: current.y + dy * perPixelY };
      });
    },
    [contentWidth, contentHeight, toUser, zoomAbout],
  );

  const onPointerUp = useCallback(function up(event: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDistance.current = null;
    if (pointers.current.size === 0) setDragging(false);
  }, []);

  const reset = useCallback(function toFit() {
    setView({ scale: 1, x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback(
    function step(factor: number) {
      zoomAbout(factor, contentWidth / 2, contentHeight / 2);
    },
    [contentWidth, contentHeight, zoomAbout],
  );

  const wasDragged = useCallback(function check() {
    return dragged.current;
  }, []);

  /* The group is drawn as translate(t) scale(k), so undoing it is the inverse. */
  const toContent = useCallback(
    function invert(clientX: number, clientY: number) {
      const user = toUser(clientX, clientY);
      return { x: (user.x - view.x) / view.scale, y: (user.y - view.y) / view.scale };
    },
    [toUser, view],
  );

  return {
    attach,
    transform: `translate(${String(view.x)} ${String(view.y)}) scale(${String(view.scale)})`,
    scale: view.scale,
    dragging,
    wasDragged,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    reset,
    zoomBy,
    toContent,
  };
}
