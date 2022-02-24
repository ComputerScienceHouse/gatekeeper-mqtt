const router = require("express").Router();
const ldap = require("../ldap");
const {syncUser} = require("../sync");

function findUser(filter) {
  return new Promise((resolve, reject) => {
    ldap.client.search(
      "cn=users,cn=accounts,dc=csh,dc=rit,dc=edu",
      {
        filter,
        scope: "one",
        attributes: ["memberOf", "ipaUniqueID", "nsAccountLock"],
        paged: false,
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

function validId(id) {
  return id.match(/^[a-zA-Z0-9\-]+$/m);
}

router.get("/:id", async (req, res) => {
  if (!validId(req.params.id)) {
    res.status(422).json({
      message: "Invalid 'userId' field",
    });
    return;
  }
  let user = await req.ctx.db.collection("users").findOne({id: req.params.id});
  if (!user) {
    let userData = null;
    try {
      userData = await findUser(`(ipaUniqueID=${req.body.id})`);
    } catch (err) {
      res.status(404).json({message: "Not found"});
    }
    user = await syncUser(req.ctx.db, userData);
  }
  res.json({
    id: user.id,
    disabled: user.disabled,
    groups: user.groups,
  });
});

// I acknowledge this is not ideal.
router.get("/uuid-by-uid/:uid", async (req, res) => {
  if (!validId(req.params.uid)) {
    res.status(422).json({
      message: "Invalid 'userId' field",
    });
    return;
  }
  console.log("uuid by uid:", req.params.uid);
  try {
    const user = await findUser(`(uid=${req.params.uid})`);
    // Ensure we're updated on DB-side
    const userDocument = await syncUser(req.ctx.db, user);
    console.log("Got user", userDocument);

    return res.json(userDocument);
  } catch (err) {
    if (err.message == "User not found!") {
      return res.status(404).json({message: "User not found"});
    } else {
      console.error("Error looking up user", err);
      res.status(500).json({error: err.stack});
      throw err;
    }
  }
});

module.exports = router;
