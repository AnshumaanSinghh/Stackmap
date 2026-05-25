import Fastify from "fastify";
import cors from "@fastify/cors";
import { boardRoutes } from "./routes/boards";
import { objectRoutes } from "./routes/objects";

const start = async () => {
  const fastify = Fastify({
    logger: true,
  });

  await fastify.register(cors, {
    origin: true,
  });

  // Mock auth middleware - adds user to request
  fastify.addHook("onRequest", async (request, reply) => {
    request.user = { userId: "user_test" };
  });

  // Health check
  fastify.get("/health", async (request, reply) => {
    return { status: "ok" };
  });

  // Register routes
  await boardRoutes(fastify);
  await objectRoutes(fastify);

  const port = parseInt(process.env.API_PORT || "4000");
  const host = "0.0.0.0";

  try {
    await fastify.listen({ port, host });
    console.log(`API Server running at http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

declare global {
  namespace Express {
    interface Request {
      user?: { userId: string };
    }
  }
}
