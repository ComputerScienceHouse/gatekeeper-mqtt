import { Router } from "express";
import { doorHeartbeats } from "../state.js";
import { checkAccess } from "../access.js";

const router = Router();

router.get("/:doorId/status", (req, res) => {
  // If it's been more than 1 minute, we assume something is broken...
  const lastHeartbeat = doorHeartbeats.get(req.params.doorId);
  if (lastHeartbeat) {
    res.json({
      guess: Date.now() - lastHeartbeat > 1000 * 60 ? "offline" : "online",
      lastHeartbeat,
    });
  } else {
    res.json({
      guess: "offline",
      lastHeartbeat: 0,
    });
  }
});

router.get("/", async (req, res) => {
  const doors = await req.ctx.db.collection("doors").find({}).toArray();
  const accessResults = req.ctx.authMethod === "oidc"
    ? await Promise.all(doors.map((d) => checkAccess(req.ctx.db, req.ctx.userId, String(d._id))))
    : doors.map(() => true);

  res.json({
    doors: doors.map((door, i) => ({
      id: door._id,
      name: door.name,
      access: accessResults[i] === true,
    })),
  });
});

router.post("/:doorId/unlock", async (req, res) => {
  if (req.ctx.authMethod === "oidc") {
    const granted = await checkAccess(
      req.ctx.db,
      req.ctx.userId,
      req.params.doorId
    );
    if (!granted) {
      return res.status(403).json({ message: "Access denied" });
    }
  }
  req.ctx.mqtt.publish(`gk/${req.params.doorId}/unlock`, "");
  res.status(204).send(null);
});

export default router;
