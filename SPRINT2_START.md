# 🚀 SPRINT 2 KICKOFF - CANVAS ENGINE

**Start Date**: May 25, 2026  
**Sprint Duration**: 2-3 weeks  
**Goal**: Interactive canvas with object rendering, selection, and viewport controls

---

## ✅ Foundation Complete

Sprint 2 canvas engine foundation is now ready. Here's what has been built:

### Canvas System
- **Konva.js integration** - WebGL-ready canvas rendering
- **Grid system** - Toggleable grid with snap-to-grid support
- **Object rendering** - Rectangles, text, (more types in progress)
- **Selection** - Single & multi-select with keyboard support
- **Viewport controls** - Zoom, pan, fit-all, reset
- **Keyboard shortcuts** - 8 shortcuts configured

### State Management
- **Zustand store** - Lightweight, reactive state (15+ actions)
- **Selection system** - Track selected objects with Set
- **Viewport state** - Zoom, pan, grid settings
- **Object CRUD** - Add, update, delete operations
- **Interaction state** - Drag, hover, keyboard shortcuts

### UI Components
- **Toolbar** - Zoom buttons, view controls, toggles
- **Layers Panel** - Object list with selection & delete
- **Properties Panel** - Read-only object inspection
- **Canvas** - Main interactive area with Konva

### Backend
- **Board API** - Full CRUD with Prisma
- **Object API** - Create, read, update, delete objects
- **Auth middleware** - Foundation for user authentication
- **Database integration** - Fully typed with Prisma schema

### Utilities
- **Snap algorithms** - Snap-to-grid and snap guides
- **Point detection** - Check if point is in object
- **Bounds calculation** - Get bounding box of objects
- **ID generation** - Unique object IDs
- **Demo data** - Pre-populated canvas on load

---

## 🎯 What You Can Do Right Now

### In the Canvas
1. **Click objects** - Select blue, red, or green rectangles
2. **Multi-select** - Hold Ctrl/Cmd and click multiple objects
3. **Drag objects** - Click and drag to move them
4. **Delete objects** - Press Delete key after selecting
5. **Zoom** - Use toolbar buttons or Ctrl++/Ctrl+-
6. **Pan** - Scroll wheel zooms, middle mouse pans (in full implementation)
7. **Grid** - Toggle grid on/off in toolbar
8. **Snap** - Toggle snap-to-grid in toolbar

### Keyboard Shortcuts
```
Ctrl/Cmd + +      → Zoom in
Ctrl/Cmd + -      → Zoom out
Ctrl/Cmd + 0      → Reset view
Delete            → Delete selected
Ctrl/Cmd + A      → Select all
Escape            → Deselect all
```

---

## 🏗️ Architecture Overview

```
Frontend (Next.js)
├── Canvas Page (/canvas)
│   ├── Toolbar (controls)
│   ├── Canvas (Konva)
│   ├── Layers Panel
│   └── Properties Panel
├── State (Zustand)
│   ├── objects
│   ├── selection
│   ├── viewport (zoom, pan)
│   └── grid/snap settings
└── API Client
    ├── /api/boards/*
    └── /api/boards/*/objects/*

Backend (Fastify)
├── /api/boards (CRUD)
├── /api/boards/:id/objects (CRUD)
└── Database (Prisma)
    ├── boards
    ├── objects
    └── users
```

---

## 📂 Key Files

### Frontend Components (8 files)
```
apps/web/src/
├── app/canvas/page.tsx                 # Main canvas page
├── components/canvas/Canvas.tsx        # Konva wrapper
├── components/ui/Toolbar.tsx           # Controls
├── components/ui/LayersPanel.tsx       # Object list
├── components/ui/PropertiesPanel.tsx   # Inspector
├── store/canvas.ts                     # State (Zustand)
└── lib/canvas/
    ├── utils.ts                        # Utilities
    ├── keyboard.ts                     # Keyboard hooks
    └── demo.ts                         # Demo data
```

### Backend (3 new files)
```
apps/api/src/
├── routes/boards.ts                    # Board CRUD
├── routes/objects.ts                   # Object CRUD
└── middleware/auth.ts                  # Auth
```

### Documentation (3 files)
```
├── SPRINT2.md                          # Sprint overview
├── SPRINT2_GUIDE.md                    # Developer guide
└── SPRINT2_CHECKLIST.md                # Task checklist
```

---

## 🚀 Quick Start

### Prerequisites
```bash
# Verify installations
node --version      # Should be 18+
pnpm --version      # Should be 9+
docker --version    # Should be 20+
```

### Installation (First Time Only)
```bash
# 1. Install dependencies
pnpm install

# 2. Start Docker services
docker-compose up -d

# 3. Setup database
pnpm db:push

# Database check (optional)
pnpm prisma studio
```

### Start Development
```bash
# Start all services
pnpm dev

# Or start individually:
# Terminal 1: API
pnpm dev --filter=api

# Terminal 2: Frontend
pnpm dev --filter=web
```

### Access Canvas
Open in browser: **http://localhost:3000/canvas**

---

## 🎨 Canvas Features by Category

### Rendering ✅
- Grid with toggleable visibility
- Rectangle objects
- Text objects
- Selected object highlighting
- Hover effects

### Interaction ✅
- Click to select
- Ctrl+click for multi-select
- Drag to move
- Delete key
- Keyboard shortcuts

### Viewport ✅
- Zoom in/out (buttons + keyboard)
- Pan canvas
- Reset view
- Fit all objects
- Zoom percentage display

### Grid & Snap ✅
- Grid visibility toggle
- Snap-to-grid toggle
- Grid size adjustable
- Snap guides (foundation)

### UI ✅
- Toolbar with controls
- Layers panel with object list
- Properties inspector
- Help text
- Responsive layout

---

## 🧪 Testing Checklist

Try these actions in the canvas:

- [ ] Load canvas page without errors
- [ ] See demo objects (3 rectangles + 2 text labels)
- [ ] Click blue rectangle to select it
- [ ] Click red rectangle with Ctrl held for multi-select
- [ ] Drag a selected object to move it
- [ ] Press Delete to remove selected object
- [ ] Press Ctrl+A to select all
- [ ] Press Escape to deselect all
- [ ] Click Zoom In button (see zoom %)
- [ ] Click Zoom Out button
- [ ] Click Reset to go back to normal view
- [ ] Click Fit All to zoom to show all objects
- [ ] Toggle Grid on/off
- [ ] Toggle Snap on/off
- [ ] Check Layers panel shows all objects
- [ ] Click object in Layers panel to select
- [ ] Check Properties panel shows values
- [ ] Keyboard: Ctrl++ to zoom in
- [ ] Keyboard: Ctrl+- to zoom out
- [ ] Keyboard: Ctrl+0 to reset
- [ ] No errors in browser console

---

## 🛠️ Common Tasks

### Check if API is running
```bash
curl http://localhost:4000/health
# Should return: {"status":"ok"}
```

### Create a test board
```bash
curl -X POST http://localhost:4000/api/boards \
  -H "Content-Type: application/json" \
  -d '{"title":"My Board","description":"Test"}'
```

### View database
```bash
pnpm prisma studio
# Opens http://localhost:5555
```

### Check Docker services
```bash
docker-compose ps
# Should show: postgres, redis, minio running
```

---

## 📊 Sprint 2 Metrics

| Metric | Target | Status |
|--------|--------|--------|
| FPS @ 100 objects | 60 | ✅ Expected |
| FPS @ 1000 objects | 60 | ⚠️ Needs testing |
| Zoom response time | < 16ms | ✅ Expected |
| Object drag latency | < 16ms | ✅ Expected |
| Memory growth/hour | < 10MB | ⚠️ Needs profiling |
| Bundle size impact | < 100KB | ✅ Expected |

---

## 🎯 Next Features to Build

### This Week
1. **Rectangle creation tool** - Click tool then drag to create
2. **Selection box** - Drag to select multiple objects
3. **Resize handles** - Corner handles on selection
4. **Better snap guides** - Visual lines when snapping

### Next Week
5. **Rotation controls** - Handle or angle input
6. **Circle/Ellipse objects** - New shape type
7. **Arrow/Connector objects** - Connection lines
8. **Copy/Paste** - Duplicate objects

### Week 3
9. **Undo/Redo** - Change history
10. **Alignment tools** - Align selected objects
11. **Properties editing** - Editable color, size, etc.
12. **Performance optimization** - 10K+ objects

---

## 📚 Documentation

### Quick Reference
- **SPRINT2_GUIDE.md** - How to develop features (start here!)
- **SPRINT2_CHECKLIST.md** - Task list and progress

### Full Details
- **SPRINT2.md** - Complete sprint documentation
- **DEVELOPMENT.md** - Full development guide
- **ROADMAP.md** - Product roadmap

---

## 💡 Tips for Success

### Development
1. **Start with small features** - One tool at a time
2. **Test in browser frequently** - See changes immediately
3. **Check console** - Errors are printed there
4. **Use Konva docs** - https://konvajs.org/
5. **Small commits** - Commit working code

### Debugging
1. **React DevTools** - Browser extension for React
2. **Browser console** - Logs and errors
3. **Network tab** - API calls
4. **Prisma Studio** - Database inspection
5. **Zustand DevTools** - State inspection

### Performance
1. **Batch updates** - Update multiple objects at once
2. **Debounce events** - High-frequency events (drag, zoom)
3. **Unsubscribe** - Clean up event listeners
4. **Memoize components** - Prevent unnecessary re-renders

---

## 🚨 If Something Breaks

### Canvas Won't Load
```bash
# 1. Check for console errors
# Browser DevTools > Console

# 2. Verify API is running
curl http://localhost:4000/health

# 3. Check Docker services
docker-compose ps

# 4. Restart everything
docker-compose down -v
docker-compose up -d
pnpm db:push
pnpm dev
```

### Objects Not Rendering
```bash
# 1. Check Konva initialization
# Look for "Stage initialized" in console

# 2. Verify demo objects loaded
# Check Layers panel, should have 5 objects

# 3. Check store state
# In console: useCanvasStore.getState().objects
```

### API Errors
```bash
# 1. Check API is running
pnpm dev --filter=api

# 2. Check logs
docker-compose logs api

# 3. Test endpoint
curl http://localhost:4000/api/boards
```

---

## 🎓 Code Examples

### Adding an Action to Store
```typescript
// In canvas.ts store
duplicateSelected: () => {
  const state = get();
  const toDuplicate = state.objects.filter(obj =>
    state.selectedObjectIds.has(obj.id)
  );
  
  toDuplicate.forEach(obj => {
    const newObj = {
      ...obj,
      id: generateObjectId(),
      x: obj.x + 20,
      y: obj.y + 20,
    };
    state.addObject(newObj);
  });
}
```

### Using in Component
```typescript
// In Toolbar.tsx
const { duplicateSelected } = useCanvasStore();

<button onClick={duplicateSelected}>
  Duplicate (Ctrl+D)
</button>
```

### Creating Custom Hook
```typescript
// In lib/canvas/hooks.ts
export function useObjectSelection() {
  const {
    selectedObjectIds,
    selectObject,
    deselectObject,
    clearSelection,
  } = useCanvasStore();

  return {
    isSelected: (id: string) => selectedObjectIds.has(id),
    select: selectObject,
    deselect: deselectObject,
    clear: clearSelection,
  };
}
```

---

## 🚀 You're Ready!

Everything is set up. The foundation is solid. The patterns are established.

**Next step**: Run `pnpm dev` and open http://localhost:3000/canvas

**Have fun building!** 🎉

---

## 📞 Quick Reference Links

| Item | Link |
|------|------|
| Canvas Page | http://localhost:3000/canvas |
| API Health | http://localhost:4000/health |
| Database | http://localhost:5555 (Prisma Studio) |
| MinIO | http://localhost:9001 |
| Konva Docs | https://konvajs.org/ |
| Zustand Repo | https://github.com/pmndrs/zustand |

---

**Sprint 2 Ready! 🚀**  
**Canvas Engine Foundation Complete** ✅  
**Ready for Feature Development**

Let's build something amazing!

---

*Stackmap - AI-native system design workspace*  
*Sprint 2 - Canvas Engine - May 25, 2026*
