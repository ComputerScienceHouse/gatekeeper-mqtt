import { Router } from "express";
import { recordAudit } from "../access.js";

const router = Router();

router.post("/access", async (req, res) => {
  const { reason } = req.body;
  if (typeof reason != "string" || !reason.trim()) {
    return res.status(422).json({ message: "Missing 'reason' field" });
  }
  console.log(`access: ${req.ctx.username} viewed logs || reason: ${reason}`);
  await recordAudit(req.ctx.db, {
    username: req.ctx.username,
    name: req.ctx.name,
    action: "Viewed Logs",
    reason,
  });
  res.status(204).send(null);
});

router.get("/doors", async (req, res) => {
  const doors = await req.ctx.db.collection("accessLogs").distinct("doorName");
  res.json(doors.filter(Boolean));
});

router.get("/", async (req, res) => {
  const { cursor, since, until, search, door, granted } = req.query;
  const query = {};
  if (since || until || cursor) {
    query.timestamp = {};
    if (cursor) query.timestamp.$lt = new Date(cursor);
    if (since)  query.timestamp.$gte = new Date(since);
    if (until)  query.timestamp.$lte = new Date(until);
  }

  const ands = [];
  if (door && door !== "all") {
    ands.push({ $or: [{ doorName: door }, { door }] });
  }
  if (search) {
    const re = new RegExp(search, "i");
    ands.push({ $or: [{ doorName: re }, { door: re }, { username: re }, { name: re }] });
  }
  if (ands.length) query.$and = ands;

  if (granted === "granted") query.granted = true;
  if (granted === "denied") query.granted = false;

  const logs = await req.ctx.db
    .collection("accessLogs")
    .find(query)
    .sort({ timestamp: -1 })
    .limit(50)
    .toArray();

  const nextCursor = logs.length === 50
    ? logs[logs.length - 1].timestamp.toISOString()
    : null;

  res.json({ logs, cursor: nextCursor });
});

export default router;