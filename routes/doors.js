const router = require("express").Router();
const {doorHeartbeats} = require("../state.js");

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
  const doors = await req.ctx.db.collection("doors").find({});
  const entries = [];
  for await (const door of doors) {
    entries.push({
      id: door._id,
      name: door.name,
    });
  }
  res.json({
    doors: entries,
  });
});

router.post("/:doorId/unlock", async (req, res) => {
  req.ctx.mqtt.publish(`gk/${req.params.doorId}/unlock`, "");
  res.status(204).send(null);
});

module.exports = router;
