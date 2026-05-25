import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { CanvasObject, RectangleObject } from "@stackmap/shared";

const prisma = new PrismaClient();

export async function objectRoutes(fastify: FastifyInstance) {
  // List board objects
  fastify.get(
    "/api/boards/:boardId/objects",
    async (request: FastifyRequest<{ Params: { boardId: string } }>, reply: FastifyReply) => {
      try {
        const { boardId } = request.params;

        const objects = await prisma.boardObject.findMany({
          where: { boardId },
        });

        return reply.send({
          data: objects.map((obj) => ({
            ...obj.data,
            id: obj.id,
            type: obj.type,
            x: obj.x,
            y: obj.y,
            rotation: obj.rotation,
          })),
        });
      } catch (error) {
        return reply.code(500).send({ error: "Failed to fetch objects" });
      }
    }
  );

  // Create object
  fastify.post(
    "/api/boards/:boardId/objects",
    async (
      request: FastifyRequest<{
        Params: { boardId: string };
        Body: CanvasObject;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { boardId } = request.params;
        const objectData = request.body;
        const userId = request.user?.userId || "user_test";

        const obj = await prisma.boardObject.create({
          data: {
            boardId,
            type: objectData.type,
            x: objectData.x,
            y: objectData.y,
            rotation: objectData.rotation,
            width: "width" in objectData ? objectData.width : null,
            height: "height" in objectData ? objectData.height : null,
            data: objectData,
            createdBy: userId,
          },
        });

        return reply.code(201).send({
          data: {
            ...obj.data,
            id: obj.id,
            type: obj.type,
            x: obj.x,
            y: obj.y,
            rotation: obj.rotation,
          },
        });
      } catch (error) {
        console.error(error);
        return reply.code(500).send({ error: "Failed to create object" });
      }
    }
  );

  // Update object
  fastify.put(
    "/api/boards/:boardId/objects/:objectId",
    async (
      request: FastifyRequest<{
        Params: { boardId: string; objectId: string };
        Body: Partial<CanvasObject>;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { boardId, objectId } = request.params;
        const updates = request.body;

        const obj = await prisma.boardObject.update({
          where: { id: objectId },
          data: {
            x: updates.x || undefined,
            y: updates.y || undefined,
            rotation: updates.rotation || undefined,
            width: "width" in updates ? updates.width : undefined,
            height: "height" in updates ? updates.height : undefined,
            data: updates,
          },
        });

        return reply.send({
          data: {
            ...obj.data,
            id: obj.id,
            type: obj.type,
            x: obj.x,
            y: obj.y,
            rotation: obj.rotation,
          },
        });
      } catch (error) {
        return reply.code(500).send({ error: "Failed to update object" });
      }
    }
  );

  // Delete object
  fastify.delete(
    "/api/boards/:boardId/objects/:objectId",
    async (
      request: FastifyRequest<{ Params: { boardId: string; objectId: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const { objectId } = request.params;

        await prisma.boardObject.delete({
          where: { id: objectId },
        });

        return reply.code(204).send();
      } catch (error) {
        return reply.code(500).send({ error: "Failed to delete object" });
      }
    }
  );
}
