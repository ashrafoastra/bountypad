import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "../app";

/**
 * Coin images. Stored on the API's disk (UPLOAD_DIR, default api/.data/uploads), named by
 * their sha256 so the same image is stored once and links never change. On a multi-server
 * deployment, point UPLOAD_DIR at shared storage or swap this for S3 / R2.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: { ext: string; mime: string; magic: (b: Buffer) => boolean }[] = [
  { ext: "png", mime: "image/png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", mime: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "webp", mime: "image/webp", magic: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
  { ext: "gif", mime: "image/gif", magic: (b) => b.subarray(0, 4).toString("ascii") === "GIF8" },
];

export async function uploadRoutes(app: FastifyInstance, ctx: Ctx) {
  const dir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), ".data/uploads");
  await mkdir(dir, { recursive: true });

  app.post("/api/uploads", { bodyLimit: Math.ceil(MAX_BYTES * 1.4) + 1024 }, async (req, reply) => {
    const { data } = z.object({ data: z.string().min(16) }).parse(req.body);
    const bytes = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (bytes.length > MAX_BYTES) return reply.status(413).send({ error: "Image is larger than 2 MB" });
    const t = TYPES.find((x) => x.magic(bytes));
    if (!t) return reply.status(415).send({ error: "Use a PNG, JPG, WebP or GIF image" });
    const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${t.ext}`;
    const file = path.join(dir, name);
    await stat(file).catch(() => writeFile(file, bytes));
    return { url: `${ctx.env.publicApiUrl}/api/files/${name}` };
  });

  app.get("/api/files/:name", async (req, reply) => {
    const name = (req.params as any).name as string;
    if (!/^[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(name)) return reply.status(404).send({ error: "not found" });
    const bytes = await readFile(path.join(dir, name)).catch(() => null);
    if (!bytes) return reply.status(404).send({ error: "not found" });
    reply.header("Content-Type", TYPES.find((t) => name.endsWith("." + t.ext))!.mime);
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(bytes);
  });
}
