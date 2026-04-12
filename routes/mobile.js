import { Router } from "express";
import crypto from "crypto";
import { oidcAuth } from "../middleware/oidc.js";
import { REALM_NAMES } from "../constants.js";

const router = Router();

router.use(oidcAuth);

router.get("/provision", async (req, res) => {
  const stem = { userId: req.ctx.userId, mobile: true };
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

export default router;
