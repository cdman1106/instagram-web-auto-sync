import app from "./index.js";

export default {
  async fetch(request, env, ctx) {
    try {
      return await app.fetch(request, env, ctx);
    } catch (error) {
      if (error instanceof Response) return error;
      console.error("top-level worker error", {
        name: error?.name,
        message: error?.message,
      });
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
  },

  async scheduled(event, env, ctx) {
    return app.scheduled(event, env, ctx);
  },
};
