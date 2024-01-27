const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const ldap = require("../ldap");
const fetchPromise = import("node-fetch");

const REALM_NAMES = ["doors", "drink", "memberProjects"];

function findUser(filter) {
  return new Promise((resolve, reject) => {
    ldap.client.search(
      "cn=users,cn=accounts,dc=csh,dc=rit,dc=edu",
      {
        filter,
        scope: "one",
        attributes: ["ipaUniqueID", "nsAccountLock"],
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
      },
    );
  });
}

router.use(async (req, response, next) => {
  const fetch = (await fetchPromise).default;
  if (!req.headers.authorization) {
    response.status(401).send("No authorization header");
    return;
  }
  const tokenParts = req.headers.authorization.split(" ");
  if (tokenParts.length != 2) {
    response.status(401).send("Invalid authorization header");
    return;
  }
  const parts = tokenParts[1].split(".");
  if (parts.length != 3) {
    response.status(401).send("Invalid authorization header");
    return;
  }
  const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
  if (payload.scope.split(" ").includes("gatekeeper_provision")) {
    response
      .status(403)
      .send("Tokens issued for other clients are not allowed");
    return;
  }
  const res = await fetch(
    "https://sso.csh.rit.edu/auth/realms/csh/protocol/openid-connect/userinfo",
    {
      headers: {
        Authorization: req.headers.authorization,
      },
    },
  );
  if (res.status != 200) {
    response.status(403).send("Unauthorized");
    return;
  }
  const user = await res.json();
  req.ctx.user = user;
  const ipaUser = await findUser(`uid=${user.preferred_username}`);
  req.ctx.userId = ipaUser.attributes
    .find((attribute) => attribute.type == "ipaUniqueID")
    ._vals[0].toString("utf8");
  next();
});

router.get("/provision", async (req, res) => {
  const stem = {userId: req.ctx.userId, mobile: true};
  let key = await req.ctx.db.collection("keys").findOne(stem);
  if (!key) {
    key = {
      enabled: true,
      _id: crypto.randomBytes(18).toString("hex"),
      uid: null,
      ...stem,
    };
    for (const name of REALM_NAMES) {
      key[name + "Id"] = crypto.randomBytes(18).toString("hex");
    }

    await req.ctx.db.collection("keys").insertOne(key);
  }
  const output = {};
  for (const name of REALM_NAMES) {
    output[name + "Id"] = key[name + "Id"];
  }
  res.json(output);
});

module.exports = router;
