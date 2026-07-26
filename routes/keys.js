  import { Router } from "express";
  import crypto from "crypto";
  import { REALM_NAMES } from "../constants.js";
  import { recordAudit } from "../access.js";

  const router = Router();

  router.post("/access", async (req, res) => {
      const { reason } = req.body;
      if (typeof reason != "string" || !reason.trim()) {
          return res.status(422).json({ message: "Missing reason field" });
      }
      console.log(`access: ${req.ctx.username} viewed keys || reason: ${reason}`);
      await recordAudit(req.ctx.db, {
        username: req.ctx.username,
        name: req.ctx.name,
        action: "Viewed Keys",
        reason,
      });
      res.status(204).send(null);
  });

  router.get("/by-user", async (req, res) => {
    if (typeof req.query.userId != "string") {
      return res.status(422).json({ message: "Missing 'userId' query param" });
    }
    const keys = await req.ctx.db.collection("keys").find({ userId: req.query.userId }).toArray();
    res.json(keys);
  });

  // First, PUT /keys with details of user key is for
  // Receive a keyId back which is our association
  // Register key using association and send back the now-randomised UID
  // with PATCH /keys/:id

  router.put("/", async (req, res) => {
    console.log(req.body);
    if (typeof req.body.userId != "string") {
      res.status(422).json({
        message: "No 'userId' field specified",
      });
      return;
    }
    if (typeof req.body.uid != "string") {
      res.status(422).json({
        message: "No 'uid' field specified",
      });
      return;
    }

    const keys = {};
    for (const name of REALM_NAMES) {
      keys[name + "Id"] = crypto.randomBytes(18).toString("hex");
    }

    const insertedKey = await req.ctx.db.collection("keys").insertOne({
      // Make sure it's something at least reasonable...
      _id: crypto.randomBytes(18).toString("hex"),
      userId: req.body.userId,
      uid: req.body.uid,
      // Not created yet, so we'll just leave it disabled for now
      enabled: false,

      ...keys,
    });
    res.json({
      keyId: insertedKey.insertedId,
      uid: req.body.uid,
      ...keys,
    });
  });

  router.patch("/:id", async (req, res) => {
    const updates = {};
    for (const key of ["uid", "userId", "enabled"]) {
      if (key in req.body) {
        updates[key] = req.body[key];
      }
    }

    const owner = req.body.username ?? "not found";
    console.log(`access: ${req.ctx.username} updated ${owner}'s key ${req.params.id}`);
    await req.ctx.db.collection("keys").updateOne(
      {
        _id: {$eq: req.params.id},
      },
      {
        $set: updates,
      }
    );
    const change = updates.enabled === false ? "Disabled" : updates.enabled === true ? "Enabled" : "updated";
    await recordAudit(req.ctx.db, {
      username: req.ctx.username,
      name: req.ctx.name,
      action: "Updated Keys",
      reason: `${change} ${owner}'s key ${req.params.id}`,
  });
    res.status(204).send(null);
  });

  router.get("/by-association/:id", async (req, res) => {
    const key = await req.ctx.db.collection("keys").findOne({
      $or: REALM_NAMES.map((key) => ({
        [key + "Id"]: {
          $eq: req.params.id,
        },
      })),
    });

    if (key) {
      const data = {
        keyId: key._id,
        uid: key.uid,
      };
      for (const name of REALM_NAMES) {
        data[name + "Id"] = key[name + "Id"];
      }
      return res.json(data);
    } else {
      return res.status(404).json({
        message: "No such key!",
      });
    }
  });

  router.delete("/by-user", async (req, res) => {
    if (typeof req.body.userId != "string") {
      return res.status(422).json({
        message: "Missing 'userId'",
      });
    }
    const results = await req.ctx.db.collection("keys").deleteMany({
      userId: {$eq: req.body.userId},
    });
    if (results.deletedCount) {
      return res.status(204).send(null);
    } else {
      return res.status(404).json({
        message: "No keys attached to user!",
      });
    }
  });

  router.delete("/:keyId", async (req, res) => {
    const owner = req.body?.username ?? "unknown";

    const results = await req.ctx.db.collection("keys").deleteOne({
      _id: {$eq: req.params.keyId},
    });
    if (results.deletedCount) {
      console.log(`keys: ${req.ctx.username} deleted ${owner}'s key ${req.params.keyId}`);
      await recordAudit(req.ctx.db,{
        username: req.ctx.username,
        name: req.ctx.name,
        action: "Deleted Keys",
        reason: `deleted ${owner}'s key ${req.params.keyId}`,
      });
      return res.status(204).send(null);
    } else {
      return res.status(404).json({
        message: "No keys attached to user!",
      });
    }
  });

  export default router;
