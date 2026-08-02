import { Router } from "express";
const router = Router();

export async function recordAudit(db, entry) {
  return db
    .collection("auditLogs")
    .insertOne({ ...entry, timestamp: new Date() })
    .catch((err) => {
      console.error("Failed to write audit entry", err);
      throw err;
    });
}

router.get("/", async (req, res) => {
  const { cursor, search, action } = req.query;
  const query = {};

  if (cursor) {
    query.timestamp = { $lt: new Date(cursor) };
  }

  const ands = [];
  if (action && action !== "all") ands.push({ action });
  if (search) {
    const re = new RegExp(search, "i");
    ands.push({ $or: [{ username: re }, { name: re }, { reason: re }] });
  }
  if (ands.length) query.$and = ands;

  const entries = await req.ctx.db
    .collection("auditLogs")
    .find(query)
    .sort({ timestamp: -1 })
    .limit(50)
    .toArray();

  const nextCursor =
    entries.length === 50
      ? entries[entries.length - 1].timestamp.toISOString()
      : null;

  res.json({ entries, cursor: nextCursor });
});

export default router;
