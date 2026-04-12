import { Router } from "express";
import { searchOne } from "../ldap.js";
import { syncUser } from "../sync.js";

const router = Router();

const USER_BASE = "cn=users,cn=accounts,dc=csh,dc=rit,dc=edu";
const USER_ATTRS = ["memberOf", "ipaUniqueID", "nsAccountLock"];

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
      userData = await searchOne(USER_BASE, `(ipaUniqueID=${req.body.id})`, USER_ATTRS);
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
    const user = await searchOne(USER_BASE, `(uid=${req.params.uid})`, USER_ATTRS);
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

export default router;
