import { FastifyRequest, FastifyReply } from "fastify";

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const token = request.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return reply.code(401).send({ error: "Missing authorization token" });
    }

    // TODO: Verify JWT token
    // For now, just extract userId from token
    const userId = "user_test"; // This should come from verifyToken()

    request.user = { userId };
  } catch (error) {
    return reply.code(401).send({ error: "Invalid token" });
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: { userId: string };
    }
  }
}
