const router = require("express").Router();
const crypto = require("crypto");

const REALM_NAMES = ["doors", "drink", "memberProjects"];

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
  await req.ctx.db.collection("keys").updateOne(
    {
      _id: {$eq: req.params.id},
    },
    {
      $set: updates,
    }
  );
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
  let id;
  try {
    id = mongo.ObjectId(req.params.keyId);
  } catch (err) {
    res.status(422).json({
      message: err.message,
    });
    return;
  }
  const results = await req.ctx.db.collection("keys").deleteOne({
    _id: {$eq: id},
  });
  if (results.deletedCount) {
    return res.status(204).send(null);
  } else {
    return res.status(404).json({
      message: "No keys attached to user!",
    });
  }
});

module.exports = router;
