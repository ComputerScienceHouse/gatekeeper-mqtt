const router = require("express").Router();

router.put("/", async (req, res) => {
  if (typeof req.body.id != "string") {
    res.status(422).json({
      message: "No 'userId' field specified",
    });
    return;
  }

  if (req.body.groups && !Array.isArray(req.body.groups)) {
    res.status(422).json({
      message: "Invalid groups specified",
    });
    return;
  }

  try {
    await req.ctx.db.collection("users").insertOne({
      id: req.body.id,
      groups: req.body.groups || [],
    });
  } catch (err) {
    res.status(409).json({
      message: "User already exists",
    });
    return;
  }
  res.status(204).send(null);
});

router.get("/:id", async (req, res) => {
  const user = await req.ctx.db
    .collection("users")
    .findOne({id: req.params.id});
  if (!user) {
    return res.status(404).json({
      message: "Not found",
    });
  }
  res.json({
    id: user.id,
    groups: user.groups,
  });
});

router.patch("/:id", async (req, res) => {
  for (const key of ["groups", "id"]) {
    if (key in req.body) {
      updates[key] = req.body[key];
    }
  }
  await req.ctx.db.collection("users").updateOne(
    {id: req.params.id},
    {
      $set: updates,
    }
  );
});

module.exports = router;
