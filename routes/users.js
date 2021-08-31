const router = require("express").Router();
const ldap = require("../ldap");

function findUserByUID(uid) {
  return new Promise((resolve, reject) => {
    ldap.client.search(
      "cn=users,cn=accounts,dc=csh,dc=rit,dc=edu",
      {
        filter: `(uid=${uid})`,
        scope: "sub",
        paged: true,
        sizeLimit: 1,
      },
      (err, res) => {
        if (err) {
          reject(err);
        } else {
          // Don't leak memory:
          function onSearchEntry(entry) {
            resolve(entry);
            res.removeListener("end", onEnd);
          }
          function onEnd() {
            res.removeListener("searchEntry", onSearchEntry);
            reject(new Error("User not found!"));
          }
          res.once("searchEntry", onSearchEntry);
          res.once("end", onEnd);
        }
      }
    );
  });
}

router.put("/", async (req, res) => {
  if (typeof req.body.id != "string") {
    res.status(422).json({
      message: "No 'userId' field specified",
    });
    return;
  }
  // Already exists...
  if (
    await req.ctx.db.collection("users").countDocuments({
      id: req.body.id,
    })
  ) {
    res.status(409).json({message: "User already exists"});
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

// I acknowledge this is not ideal.
router.get("/uuid-by-uid/:uid", async (req, res) => {
  console.log("uuid by uid:", req.params.uid);
  const user = await findUserByUID(req.params.uid);
  return res.json({
    ipaUniqueID: user.attributes
      .find((attribute) => attribute.type == "ipaUniqueID")
      ._vals[0].toString("utf8"),
    groups: user.attributes
      .find((attribute) => attribute.type == "ipaUniqueID")
      ._vals.map((value) => value.toString("utf8")),
  });
});

module.exports = router;
