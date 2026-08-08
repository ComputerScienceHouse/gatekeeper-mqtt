import { Router } from "express";
import { doorHeartbeats } from "../state.js";
import { checkAccess } from "../access.js";
import { recordDoorUnlock } from "./logs.js";

const router = Router();

function isDoorOffline(doorId) {
  // If it's been more than 1 minute, we assume something is broken...
  const lastHeartbeat = doorHeartbeats.get(doorId);
  if (!lastHeartbeat) return true;
  return Date.now() - lastHeartbeat > 1000 * 60;
}

function getDoorStatus(doorId) {
  const lastHeartbeat = doorHeartbeats.get(doorId);
  return {
    guess: isDoorOffline(doorId) ? "offline" : "online",
    lastHeartbeat: lastHeartbeat || 0,
  };
}

router.get("/:doorId/status", (req, res) => {
  res.json(getDoorStatus(req.params.doorId));
});

router.get("/", async (req, res) => {
  const doors = await req.ctx.db.collection("doors").find({}).toArray();
  const accessResults = req.ctx.userId
    ? await Promise.all(
        doors.map((d) =>
          checkAccess(req.ctx.db, req.ctx.userId, String(d._id)),
        ),
      )
    : doors.map(() => false);

  res.json({
    doors: doors.map((door, i) => ({
      id: door._id,
      name: door.name,
      access: accessResults[i] === true,
    })),
  });
});

router.post("/:doorId/unlock", async (req, res) => {
  if (!req.ctx.userId) {
    //auth method should always have a user identity
    return res.status(403).json({ message: "Access denied" });
  }

  const granted = await checkAccess(
    req.ctx.db,
    req.ctx.userId,
    req.params.doorId,
  );

  if (!granted) {
    return res.status(403).json({ message: "Access denied" });
  }

  if (isDoorOffline(req.params.doorId)) {
    return res.status(400).json({ message: "Door is offline" });
  }

  const doorDoc = await req.ctx.db
    .collection("doors")
    .findOne({ _id: req.params.doorId });
  await recordDoorUnlock(req.ctx.db, {
    doorId: req.params.doorId,
    doorName: doorDoc?.name,
    username: req.ctx.username ?? req.ctx.userId,
    name: req.ctx.name,
    accessType: req.ctx.authMethod,
  });

  req.ctx.mqtt.publish(`gk/${req.params.doorId}/unlock`, "");
  res.status(204).send(null);
});

export default router;
