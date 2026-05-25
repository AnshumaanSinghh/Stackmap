# SPRINT 2 - CANVAS ENGINE

**Status**: In Progress  
**Start Date**: May 25, 2026  
**Target Duration**: 2-3 weeks  
**Goal**: Core canvas rendering, interaction, and viewport controls

---

## ✅ Completed in Sprint 2 (So Far)

### Frontend - Canvas System
- ✅ Canvas store with Zustand (zoom, pan, selection, grid, snap)
- ✅ Konva canvas component with rendering
- ✅ Toolbar with zoom, view, grid, snap controls
- ✅ Layers panel for object list management
- ✅ Properties panel for object inspection
- ✅ Canvas utilities (snap, guides, bounds, point detection)
- ✅ Canvas page integration

### Frontend - State Management
- ✅ Advanced canvas store with 15+ actions
- ✅ Selection system (single & multi-select)
- ✅ Object CRUD operations
- ✅ Viewport controls (zoom, pan, fit)
- ✅ Grid and snap-to-grid system

### Backend - API
- ✅ Board endpoints (list, get, create, update, delete)
- ✅ Object endpoints (list, create, update, delete)
- ✅ Prisma integration
- ✅ Auth middleware foundation

### Components
- ✅ Canvas.tsx - Main canvas component
- ✅ Toolbar.tsx - Zoom and view controls
- ✅ LayersPanel.tsx - Object list
- ✅ PropertiesPanel.tsx - Object properties
- ✅ Canvas utilities for interaction

---

## 📋 Sprint 2 Backlog

### High Priority (This Sprint)

#### Canvas Rendering
- [ ] Rectangle with resize handles
- [ ] Circle/Ellipse rendering
- [ ] Text object rendering
- [ ] Sticky note rendering
- [ ] Arrow/connector rendering

#### Selection & Interaction
- [ ] Single-click selection
- [ ] Multi-select with Ctrl+click
- [ ] Selection box (drag to select multiple)
- [ ] Keyboard delete (Delete key)
- [ ] Keyboard shortcuts (Ctrl+A, Ctrl+Z, etc.)

#### Drag & Move
- [ ] Drag selected objects
- [ ] Snap-to-grid while dragging
- [ ] Snap guides from nearby objects
- [ ] Multi-object drag
- [ ] Undo on drag complete

#### Resize & Transform
- [ ] Resize handles on selection
- [ ] Aspect ratio lock (Shift+drag)
- [ ] Rotation handle
- [ ] Keyboard transform (Arrow keys)

#### Viewport
- [ ] Mouse wheel zoom
- [ ] Zoom in/out buttons
- [ ] Fit all objects in view
- [ ] Pan canvas (middle mouse)
- [ ] Keyboard shortcuts (Ctrl++, Ctrl+-)

#### Grid & Snap
- [ ] Toggle grid visibility
- [ ] Toggle snap-to-grid
- [ ] Adjust grid size
- [ ] Visual snap guides
- [ ] Snap to edges

### Medium Priority (Later Sprints)

#### Advanced Features
- [ ] Copy/paste objects
- [ ] Duplicate objects (Ctrl+D)
- [ ] Bring forward/send backward
- [ ] Group/ungroup
- [ ] Alignment tools
- [ ] Distribution tools

#### UI Polish
- [ ] Keyboard shortcuts panel
- [ ] Undo/redo history
- [ ] Search/filter objects
- [ ] Zoom presets
- [ ] Fullscreen mode

#### Performance
- [ ] Virtual rendering for 10K+ objects
- [ ] Efficient re-rendering
- [ ] Memory optimization
- [ ] Event debouncing

### Lower Priority

- [ ] Touch/mobile support
- [ ] Dark mode canvas
- [ ] Custom cursors
- [ ] Animation on creation

---

## 🏗️ Architecture

### Canvas Component Tree
```
Canvas Page
├── Toolbar
│   ├── Zoom Controls
│   ├── View Controls
│   └── Grid/Snap Toggle
├── Main Layout
│   ├── LayersPanel
│   │   └── Object List
│   ├── Canvas
│   │   ├── Konva Stage
│   │   ├── Grid Layer
│   │   ├── Objects Layer
│   │   └── Selection Layer
│   └── PropertiesPanel
│       └── Object Properties
```

### Data Flow
```
Canvas Component
    ↓
useCanvasStore (Zustand)
    ├── objects: CanvasObject[]
    ├── selectedObjectIds: Set<string>
    ├── zoom, pan, grid state
    └── Actions: select, update, delete, etc.
    ↓
Konva Stage/Layer
    ├── Render grid
    ├── Render objects
    ├── Render selection
    └── Handle interactions
    ↓
API (boardApi, objectApi)
    ├── Create objects
    ├── Update objects
    └── Delete objects
```

### File Structure
```
apps/web/src/
├── app/
│   └── canvas/
│       └── page.tsx (Main canvas page)
├── components/
│   ├── canvas/
│   │   └── Canvas.tsx (Konva wrapper)
│   └── ui/
│       ├── Toolbar.tsx
│       ├── LayersPanel.tsx
│       └── PropertiesPanel.tsx
├── lib/
│   └── canvas/
│       └── utils.ts (Snap, bounds, point detection)
└── store/
    └── canvas.ts (Zustand store)

apps/api/src/
├── routes/
│   ├── boards.ts (Board CRUD)
│   └── objects.ts (Object CRUD)
├── middleware/
│   └── auth.ts (Auth checks)
└── index.ts (Fastify setup)
```

---

## 🎯 Definition of Done - Sprint 2

A feature is considered done when:

1. ✅ Component created and integrated
2. ✅ State management wired up
3. ✅ API endpoints working
4. ✅ User interaction working
5. ✅ Basic styling applied
6. ✅ Error handling in place
7. ✅ No console errors
8. ✅ Code commented where needed

---

## 📊 Sprint Metrics

### Code Quality
- Target: 0 TypeScript errors
- Target: All features have tests
- Target: <80 KB bundle impact

### Performance
- Target: 60 FPS @ 1000 objects
- Target: < 16ms per frame
- Target: < 100ms save latency

### User Experience
- Target: All shortcuts documented
- Target: Helpful error messages
- Target: Smooth animations

---

## 🔄 Daily Standup Template

```
What I did yesterday:
- [ ] Item

What I'm doing today:
- [ ] Item

Blockers:
- None

PRs/Reviews needed:
- None
```

---

## 🐛 Known Issues

### Canvas Rendering
- Konva rendering can lag with 10K+ objects (needs virtual rendering)
- Grid lines don't scale with zoom properly (needs refactor)
- Selection box not yet implemented

### API
- No real authentication (using mock user_test)
- No validation on object creation
- No error handling for concurrent edits

### State Management
- Zustand store can cause unnecessary re-renders with large object arrays
- Selection updates not optimized

---

## 🚀 Quick Start for Sprint 2

### Setup
```bash
cd Stackmap
pnpm install
docker-compose up -d
pnpm db:push
```

### Development
```bash
# Terminal 1: Start API
pnpm dev --filter=api

# Terminal 2: Start frontend
pnpm dev --filter=web

# Visit: http://localhost:3000/canvas
```

### Testing
```bash
# Type check
pnpm type-check

# Lint
pnpm lint

# Test
pnpm test
```

---

## 🎓 Learning Resources

### Konva.js
- [Official Docs](https://konvajs.org/)
- [Shapes Tutorial](https://konvajs.org/docs/shapes/Rect.html)
- [Events Reference](https://konvajs.org/docs/events/Bind_Events.html)

### Zustand
- [GitHub Repo](https://github.com/pmndrs/zustand)
- [Documentation](https://github.com/pmndrs/zustand/wiki/Introduction)

### Fastify
- [Official Docs](https://www.fastify.io/)
- [Routes Guide](https://www.fastify.io/docs/latest/Guides/Routes/)

---

## 📝 Notes

### Design Decisions
- Using Zustand instead of Redux for lighter state management
- Konva.js instead of Three.js/Babylon for Canvas2D rendering
- Single layer approach (can optimize with multiple layers later)

### Technical Debt
- Need to add error boundaries
- Add loading states to all API calls
- Optimize re-renders in canvas
- Add proper TypeScript types for Konva nodes

### Future Improvements
- Virtual rendering for 100K+ objects
- WebGL rendering with Pixi.js
- Advanced transform tools
- Plugin system for custom objects

---

## 🔗 Related Documents

- [ROADMAP.md](../../ROADMAP.md) - Product roadmap
- [DEVELOPMENT.md](../../DEVELOPMENT.md) - Full dev guide
- [BUILD.md](../../BUILD.md) - Sprint 1 details

---

**Sprint 2 Target**: Foundation canvas engine with rendering, selection, and viewport controls

**Success Criteria**: 
- ✅ Render canvas objects smoothly
- ✅ Select and manipulate objects
- ✅ Control viewport (zoom, pan)
- ✅ Basic UI controls
- ✅ API integration working

---

**Last Updated**: May 25, 2026  
**Sprint Duration**: 2-3 weeks  
**Next Sprint**: Sprint 3 (Real-time Collaboration)
