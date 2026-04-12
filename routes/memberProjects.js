import { Router } from "express";
import { searchOne } from "../ldap.js";

const router = Router();

const USER_BASE = "cn=users,cn=accounts,dc=csh,dc=rit,dc=edu";

const ARRAYS = new Set([
  "memberOf",
  "mail",
  "objectClass",
  "ipaSshPubKey",
  "ibutton",
]);

router.get("/by-key/:associationId", async (req, res) => {
  const key = await req.ctx.db.collection("keys").findOne({
    [req.associationType]: {$eq: req.params.associationId},
  });

  if (!key) {
    res.status(404).json({message: "Not found"});
    return;
  }

  const userDocument = await req.ctx.db.collection("users").findOne({
    id: {$eq: key.userId},
    disabled: {$ne: true},
  });
  if (!userDocument) {
    res.status(404).json({message: "User not found or disabled"});
    return;
  }

  let user;
  try {
    user = await searchOne(USER_BASE, `(ipaUniqueID=${key.userId})`);
  } catch (err) {
    res.status(500).json({message: "Internal server error"});
    return;
  }

  const response = {};
  for (const attribute of user.attributes) {
    if (attribute.type == "jpegPhoto") {
      response[attribute.type] = attribute._vals[0].toString("base64");
    } else {
      const values = attribute._vals.map((value) => value.toString("utf8"));
      if (ARRAYS.has(attribute.type)) {
        response[attribute.type] = values;
      } else {
        if (values.length > 1) {
          console.warn(`${attribute.type} has many values!!`);
        }
        response[attribute.type] = values.join(",");
      }
    }
  }

  res.json({
    user: response,
  });
});

export default router;
