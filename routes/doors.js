import { Router } from "express";
import { doorHeartbeats } from "../state.js";
import { checkAccess, recordDoorUnlock } from "../access.js";
import { ObjectId } from "mongodb";

const router = Router();

function getDoorStatus(doorId){
  // If it's been more than 1 minute, we assume something is broken...
  const lastHeartbeat = doorHeartbeats.get(doorId);
  if (lastHeartbeat) {
    return {
      guess: Date.now() - lastHeartbeat > 1000 * 60 ? "offline" : "online",
      lastHeartbeat,
    };
  } else {
    return {
      guess: "offline",
      lastHeartbeat: 0,
    };
  }
}

router.get("/:doorId/status", (req, res) => {
  res.json(getDoorStatus(req.params.doorId));
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

  if (getDoorStatus(req.params.doorId).guess === "offline") {
    return res.status(409).json({ message: "Door is offline" });
  }

  if (req.ctx.authMethod === "oidc") {
    const doorId = req.params.doorId;
    const doorDoc = await req.ctx.db.collection("doors").findOne({
      $or: [
        { _id: doorId },
        ...(ObjectId.isValid(doorId) ? [{ _id: new ObjectId(doorId) }] : []),
      ],
    });

    await recordDoorUnlock(req.ctx.db, {
      doorId: req.params.doorId,
      doorName: doorDoc?.name,
      username: req.ctx.username ?? req.ctx.userId,
      name: req.ctx.name,
    });
  }

  req.ctx.mqtt.publish(`gk/${req.params.doorId}/unlock`, "");
  res.status(204).send(null);
});

export default router;
