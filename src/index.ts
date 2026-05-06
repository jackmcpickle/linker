import { Hono } from "hono";
import type { Env } from "./types";

const app = new Hono<Env>();

app.get("/health", (c) => c.text("ok"));

// Stage 1 placeholder. Real dispatch comes in stage 3.
app.all("*", (c) => {
  const host = c.req.header("host") ?? "";
  const url = new URL(c.req.url);
  return c.text(`habits-linker scaffold\nhost: ${host}\npath: ${url.pathname}\n`);
});

export default app;
