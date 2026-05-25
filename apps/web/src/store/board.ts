import React from "react";
import { create } from "zustand";
import { CanvasObject, Board } from "@stackmap/shared";

interface BoardStore {
  board: Board | null;
  selectedObject: CanvasObject | null;
  isLoading: boolean;

  setBoard: (board: Board) => void;
  setSelectedObject: (object: CanvasObject | null) => void;
  addObject: (object: CanvasObject) => void;
  updateObject: (id: string, updates: Partial<CanvasObject>) => void;
  deleteObject: (id: string) => void;
}

export const useBoardStore = create<BoardStore>((set) => ({
  board: null,
  selectedObject: null,
  isLoading: false,

  setBoard: (board) => set({ board }),
  setSelectedObject: (object) => set({ selectedObject: object }),

  addObject: (object) =>
    set((state) => ({
      board: state.board
        ? {
            ...state.board,
            objects: [...state.board.objects, object],
          }
        : null,
    })),

  updateObject: (id, updates) =>
    set((state) => ({
      board: state.board
        ? {
            ...state.board,
            objects: state.board.objects.map((obj) =>
              obj.id === id ? ({ ...obj, ...updates } as CanvasObject) : obj
            ),
          }
        : null,
    })),

  deleteObject: (id) =>
    set((state) => ({
      board: state.board
        ? {
            ...state.board,
            objects: state.board.objects.filter((obj) => obj.id !== id),
          }
        : null,
    })),
}));
