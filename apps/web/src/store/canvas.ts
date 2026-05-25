import { create } from "zustand";
import { CanvasObject, Board } from "@stackmap/shared";

export interface CanvasState {
  board: Board | null;
  objects: CanvasObject[];
  selectedObjectIds: Set<string>;
  hoveredObjectId: string | null;
  zoom: number;
  panX: number;
  panY: number;
  gridSize: number;
  showGrid: boolean;
  snapToGrid: boolean;
  isDragging: boolean;
  dragStartPos: { x: number; y: number } | null;

  // Board actions
  setBoard: (board: Board) => void;
  setObjects: (objects: CanvasObject[]) => void;

  // Selection actions
  selectObject: (id: string, multiSelect?: boolean) => void;
  deselectObject: (id: string) => void;
  clearSelection: () => void;
  setSelectedObjects: (ids: string[]) => void;
  isObjectSelected: (id: string) => boolean;

  // Object manipulation
  addObject: (object: CanvasObject) => void;
  updateObject: (id: string, updates: Partial<CanvasObject>) => void;
  deleteObject: (id: string) => void;
  deleteSelected: () => void;

  // Hover
  setHoveredObject: (id: string | null) => void;

  // Viewport
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  zoomToFit: () => void;

  // Grid and snap
  setShowGrid: (show: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
  setGridSize: (size: number) => void;

  // Drag state
  setDragging: (dragging: boolean, startPos?: { x: number; y: number }) => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  board: null,
  objects: [],
  selectedObjectIds: new Set(),
  hoveredObjectId: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  gridSize: 20,
  showGrid: true,
  snapToGrid: true,
  isDragging: false,
  dragStartPos: null,

  setBoard: (board) => set({ board }),

  setObjects: (objects) => set({ objects }),

  selectObject: (id, multiSelect = false) =>
    set((state) => {
      const newSelection = multiSelect
        ? new Set(state.selectedObjectIds)
        : new Set<string>();
      newSelection.add(id);
      return { selectedObjectIds: newSelection };
    }),

  deselectObject: (id) =>
    set((state) => {
      const newSelection = new Set(state.selectedObjectIds);
      newSelection.delete(id);
      return { selectedObjectIds: newSelection };
    }),

  clearSelection: () => set({ selectedObjectIds: new Set() }),

  setSelectedObjects: (ids) => set({ selectedObjectIds: new Set(ids) }),

  isObjectSelected: (id) => {
    const state = get();
    return state.selectedObjectIds.has(id);
  },

  addObject: (object) =>
    set((state) => ({
      objects: [...state.objects, object],
    })),

  updateObject: (id, updates) =>
    set((state) => ({
      objects: state.objects.map((obj) =>
        obj.id === id ? ({ ...obj, ...updates } as CanvasObject) : obj
      ),
    })),

  deleteObject: (id) =>
    set((state) => ({
      objects: state.objects.filter((obj) => obj.id !== id),
      selectedObjectIds: new Set(
        [...state.selectedObjectIds].filter((sid) => sid !== id)
      ),
    })),

  deleteSelected: () => {
    const state = get();
    const idsToDelete = Array.from(state.selectedObjectIds);
    idsToDelete.forEach((id) => {
      state.deleteObject(id);
    });
  },

  setHoveredObject: (id) => set({ hoveredObjectId: id }),

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(zoom, 5)) }),

  setPan: (x, y) => set({ panX: x, panY: y }),

  zoomIn: () => {
    const state = get();
    state.setZoom(state.zoom * 1.2);
  },

  zoomOut: () => {
    const state = get();
    state.setZoom(state.zoom / 1.2);
  },

  resetView: () => set({ zoom: 1, panX: 0, panY: 0 }),

  zoomToFit: () => {
    const state = get();
    if (state.objects.length === 0) {
      state.resetView();
      return;
    }

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    state.objects.forEach((obj) => {
      minX = Math.min(minX, obj.x);
      minY = Math.min(minY, obj.y);
      maxX = Math.max(
        maxX,
        obj.x + (("width" in obj && obj.width) || 100)
      );
      maxY = Math.max(
        maxY,
        obj.y + (("height" in obj && obj.height) || 100)
      );
    });

    const width = 800; // Canvas width - adjust as needed
    const height = 600; // Canvas height - adjust as needed
    const padding = 50;

    const scaleX = (width - padding * 2) / (maxX - minX);
    const scaleY = (height - padding * 2) / (maxY - minY);
    const zoom = Math.min(scaleX, scaleY);

    set({
      zoom,
      panX: (width / 2 - (minX + maxX) / 2) * zoom,
      panY: (height / 2 - (minY + maxY) / 2) * zoom,
    });
  },

  setShowGrid: (show) => set({ showGrid: show }),

  setSnapToGrid: (snap) => set({ snapToGrid: snap }),

  setGridSize: (size) => set({ gridSize: Math.max(10, size) }),

  setDragging: (dragging, startPos) =>
    set({ isDragging: dragging, dragStartPos: startPos || null }),
}));
