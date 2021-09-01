const router = require("express").Router();
const ldap = require("../ldap");

function findUser(id) {
  return new Promise((resolve, reject) => {
    ldap.client.search(
      "cn=users,cn=accounts,dc=csh,dc=rit,dc=edu",
      {
        filter: `(ipauniqueid=${id})`,
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

const ARRAYS = new Set(["memberOf", "mail", "objectClass", "ipaSshPubKey"]);
router.get("/by-key/:associationId", async (req, res) => {
  const key = await req.ctx.db.collection("keys").findOne({
    [req.associationType]: req.params.associationId,
  });

  if (!key) {
    res.status(404).json({message: "Not found"});
    return;
  }

  let user;
  try {
    user = await findUser(key.userId);
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

module.exports = router;
