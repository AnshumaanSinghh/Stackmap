# Socket.io WebSocket Server
FROM node:20-alpine AS ws-builder
WORKDIR /app
COPY . .
RUN npm install -g pnpm
RUN pnpm install
RUN pnpm run build --filter=ws

FROM node:20-alpine
WORKDIR /app
COPY --from=ws-builder /app/apps/ws/dist /app/dist
COPY --from=ws-builder /app/apps/ws/package.json /app/package.json
RUN npm install --production

EXPOSE 4001
CMD ["node", "dist/index.js"]
