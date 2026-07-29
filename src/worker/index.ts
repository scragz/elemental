// Cloudflare Worker entry. Static assets are served by the ASSETS binding; the
// worker only runs first for /api/* (see wrangler.jsonc `run_worker_first`), which
// leaves room for future endpoints without touching the instrument itself.
export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
