import { Server } from "socket.io";

const io = new Server(parseInt(process.env.WS_PORT || "4001"), {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Join a board room
  socket.on("join-room", (roomId: string) => {
    socket.join(roomId);
    console.log(`${socket.id} joined room ${roomId}`);
  });

  // Broadcast cursor position
  socket.on("cursor-update", (payload) => {
    socket.to(payload.roomId).emit("cursor-update", payload);
  });

  // Handle collaboration updates
  socket.on("update", (payload) => {
    socket.to(payload.roomId).emit("update", payload);
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

console.log(`WebSocket Server running on port ${process.env.WS_PORT || 4001}`);
