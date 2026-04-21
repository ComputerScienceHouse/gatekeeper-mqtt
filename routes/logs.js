import { Router } from "express";
const router = Router();

router.get("/", async (req, res) => {
  const cursor = req.query.cursor;
  const query = cursor ? { timestamp: { $lt: new Date(cursor) } } : {};

  const logs = await req.ctx.db
    .collection("accessLogs")
    .find(query)
    .sort({ timestamp: -1 })
    .limit(100)
    .toArray();

  const nextCursor = logs.length > 0 
    ? logs[logs.length - 1].timestamp.toISOString()
    : null;

  res.json({ logs, cursor: nextCursor });
});

export default router;