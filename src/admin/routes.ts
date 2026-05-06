import { Hono } from "hono";
import type { Env } from "../types";

const admin = new Hono<Env>();

admin.get("/_admin", (c) => c.text("admin (login coming in stage 4)"));
admin.get("/_admin/*", (c) => c.text(`admin path: ${new URL(c.req.url).pathname}`));

admin.get("/", (c) => c.redirect("/_admin"));
admin.all("*", (c) => c.text("not found", 404));

export default admin;
