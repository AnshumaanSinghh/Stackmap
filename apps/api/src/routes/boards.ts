import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { Board, CanvasObject, RectangleObject } from "@stackmap/shared";

const prisma = new PrismaClient();

export async function boardRoutes(fastify: FastifyInstance) {
  // Get all boards for user
  fastify.get("/api/boards", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user?.userId || "user_test";

      const boards = await prisma.board.findMany({
        where: { ownerId: userId },
        include: { objects: true },
      });

      return reply.send({
        data: boards.map((board) => ({
          id: board.id,
          title: board.title,
          description: board.description,
          ownerId: board.ownerId,
          objects: board.objects.map((obj) => ({
            ...obj.data,
            id: obj.id,
            type: obj.type,
            x: obj.x,
            y: obj.y,
            rotation: obj.rotation,
          })),
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
        })),
      });
    } catch (error) {
      return reply.code(500).send({ error: "Failed to fetch boards" });
    }
  });

  // Get single board
  fastify.get(
    "/api/boards/:boardId",
    async (request: FastifyRequest<{ Params: { boardId: string } }>, reply: FastifyReply) => {
      try {
        const { boardId } = request.params;

        const board = await prisma.board.findUnique({
          where: { id: boardId },
          include: { objects: true },
        });

        if (!board) {
          return reply.code(404).send({ error: "Board not found" });
        }

        return reply.send({
          data: {
            id: board.id,
            title: board.title,
            description: board.description,
            ownerId: board.ownerId,
            objects: board.objects.map((obj) => ({
              ...obj.data,
              id: obj.id,
              type: obj.type,
              x: obj.x,
              y: obj.y,
              rotation: obj.rotation,
            })),
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
          },
        });
      } catch (error) {
        return reply.code(500).send({ error: "Failed to fetch board" });
      }
    }
  );

  // Create new board
  fastify.post(
    "/api/boards",
    async (
      request: FastifyRequest<{ Body: { title: string; description?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const userId = request.user?.userId || "user_test";
        const { title, description } = request.body;

        const board = await prisma.board.create({
          data: {
            title,
            description,
            ownerId: userId,
          },
          include: { objects: true },
        });

        return reply.code(201).send({
          data: {
            id: board.id,
            title: board.title,
            description: board.description,
            ownerId: board.ownerId,
            objects: [],
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
          },
        });
      } catch (error) {
        return reply.code(500).send({ error: "Failed to create board" });
      }
    }
  );

  // Update board
  fastify.put(
    "/api/boards/:boardId",
    async (
      request: FastifyRequest<{
        Params: { boardId: string };
        Body: { title?: string; description?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { boardId } = request.params;
        const { title, description } = request.body;

        const board = await prisma.board.update({
          where: { id: boardId },
          data: { title, description },
          include: { objects: true },
        });

        return reply.send({
          data: {
            id: board.id,
            title: board.title,
            description: board.description,
            ownerId: board.ownerId,
            objects: board.objects.map((obj) => ({
              ...obj.data,
              id: obj.id,
              type: obj.type,
              x: obj.x,
              y: obj.y,
              rotation: obj.rotation,
            })),
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
          },
        });
      } catch (error) {
        return reply.code(500).send({ error: "Failed to update board" });
      }
    }
  );

  // Delete board
  fastify.delete(
    "/api/boards/:boardId",
    async (request: FastifyRequest<{ Params: { boardId: string } }>, reply: FastifyReply) => {
      try {
        const { boardId } = request.params;

        await prisma.board.delete({
          where: { id: boardId },
        });

        return reply.code(204).send();
      } catch (error) {
        return reply.code(500).send({ error: "Failed to delete board" });
      }
    }
  );
}
