# STACKMAP - QUICK START GUIDE

## ⚡ 30-Second Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start Docker services
docker-compose up -d

# 3. Setup database
pnpm db:push

# 4. Start development server
pnpm dev
```

**Services will be available at:**
- Frontend: http://localhost:3000
- API: http://localhost:4000
- WebSocket: http://localhost:4001
- MinIO: http://localhost:9001

---

## 📁 File Structure Quick Reference

```
src/                    # Source code
├── app/               # Next.js App Router (web)
├── api/               # API routes
├── components/        # React components
├── store/             # State management (Zustand)
├── routes/            # API routes (Fastify)
└── services/          # Business logic

packages/
├── shared/            # Shared types & utilities
├── canvas-engine/     # Konva wrapper
├── realtime/          # Yjs + Socket.io
├── ai-runtime/        # Claude integration
├── ui/                # Component library
├── database/          # Prisma exports
├── auth/              # Auth utilities
└── [other packages]
```

---

## 🔧 Common Tasks

### Add a new page
```bash
# Create file: apps/web/src/app/[slug]/page.tsx
# Next.js automatically creates the route
```

### Add a new API endpoint
```bash
# Create file: apps/api/src/routes/[route].ts
# Register in apps/api/src/index.ts
```

### Add database model
```bash
# Edit: prisma/schema.prisma
# Run: pnpm db:push
```

### Run tests
```bash
pnpm test
pnpm test --watch
```

### Check TypeScript
```bash
pnpm type-check
```

---

## 🐛 Quick Debugging

### View database
```bash
pnpm prisma studio
```

### Check API
```bash
curl http://localhost:4000/health
```

### View logs
```bash
docker-compose logs -f api
docker-compose logs -f postgres
```

### Reset everything
```bash
docker-compose down -v
docker-compose up -d
pnpm db:push
```

---

## 📚 Documentation

- **Full Guide**: [DEVELOPMENT.md](DEVELOPMENT.md)
- **Build Details**: [BUILD.md](BUILD.md)
- **Architecture**: [README.md](README.md)

---

## 🚀 Next Steps

1. ✅ Setup complete
2. Create a board via API
3. Connect WebSocket in frontend
4. Start canvas interaction (Sprint 2)
5. Add AI features (Sprint 3)

---

**Start developing**: `pnpm dev`

**Questions?** Check [DEVELOPMENT.md](DEVELOPMENT.md) or [BUILD.md](BUILD.md)
