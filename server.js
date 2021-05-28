const express = require("express");
const mqtt = require("mqtt");
const mongo = require("mongodb");

// Apparently, automatic reconnection is the default!
const mongoClient = new mongo.MongoClient(process.env.MONGO_HOST);
mongoClient.connect().then(() => {
  const db = mongoClient.db("gatekeeper");

  const client = mqtt.connect(process.env.GK_MQTT_SERVER);

  const app = express();

  // First, PUT /keys with details of user key is for
  // Receive a keyId back which is our association
  // Register key using association and send back the now-randomised UID
  // with PATCH /keys/:id

  app.put("/keys", async (req, res) => {
    if (!req.body.userId) {
      res.status(422).json({
        message: "No 'userId' field specified",
      });
      return;
    }
    const insertedKey = await db.collection("keys").insertOne({
      userId: req.body.userId,
      groups: req.body.groups || [],
      // No uid, so we'll leave it be for now...
      enabled: false,
    });
    res.json({
      keyId: insertedKey._id,
    });
  });

  app.patch("/keys/:id", async (req, res) => {
    const updates = {};
    for (const key of ["uid", "userId", "enabled", "groups"]) {
      if (key in req.body) {
        updates[key] = req.body[key];
      }
    }
    await db.collection("keys").updateOne(
      {
        _id: req.params.id,
      },
      {
        $set: {
          updates,
        },
      }
    );
    res.status(204).send(null);
  });

  app.delete("/keys/by-user", async (req, res) => {
    if (!req.body.userId) {
      return res.status(422).json({
        message: "Missing 'userId'",
      });
    }
    const results = await db.collection("keys").deleteMany({
      userId: req.body.userId,
    });
    if (results.deletedCount) {
      return res.status(204).send(null);
    } else {
      return res.status(404).json({
        message: "No keys attached to user!",
      });
    }
  });

  app.delete("/keys/:keyId", async (req, res) => {
    let id;
    try {
      id = mongo.ObjectId(req.params.keyId);
    } catch (err) {
      res.status(422).json({
        message: err.message,
      });
      return;
    }
    const results = await db.collection("keys").deleteOne({
      _id: id,
    });
    if (results.deletedCount) {
      return res.status(204).send(null);
    } else {
      return res.status(404).json({
        message: "No keys attached to user!",
      });
    }
  });

  // Stored in memory because it doesn't seem reasonable to put it in DB
  const doorHeartbeats = new Map();
  app.get("/doors/:doorId/status", (req, res) => {
    // If it's been more than 5 minutes, we assume something is broken...
    const lastHeartbeat = doorHeartbeats.get(req.params.doorId);
    if (lastHeartbeat) {
      res.json({
        guess:
          Date.now() - lastHeartbeat > 1000 * 60 * 5 ? "offline" : "online",
        lastHeartbeat,
      });
    } else {
      res.json({
        guess: "offline",
        lastHeartbeat: 0,
      });
    }
  });

  client.on("connect", async () => {
    console.log("Connect");
    const doors = await db.collection("doors").find({}, {_id: 1});
    console.log(doors);
    for await (const door of doors) {
      console.log("Subscribing to door", door._id);
      const prefix = `gk/${door._id}/`;
      client.subscribe(prefix + "fetch_user");
      client.subscribe(prefix + "access_requested");
    }
  });

  client.on("message", async (topic, message) => {
    let payload;
    try {
      payload = JSON.parse(message.toString("utf8"));
    } catch (err) {
      console.error("Got an invalid packet!", topic, message.toString("utf8"));
      return;
    }
    console.log(topic, payload);
    if (topic.endsWith("/fetch_user")) {
      // We can be clever about this!
      const doorId = topic.slice(3, -11);
      const key = await db.collection("keys").findOne(
        {
          uid: payload.uid,
        },
        {_id: 1}
      );
      console.log(payload.uid, key);
      console.log(doorId);
      await client.publish(`gk/${doorId}/user_response`, key ? key._id : "");
    } else if (topic.endsWith("/access_requested")) {
      const doorId = topic.slice(3, -17);
      // Here, we evaluate group membership
      const key = await db.collection("keys").findOne({
        _id: payload.association,
      });
      const userTicket = await db.collection("userTickets").findOne({
        key: key._id,
      });
      let granted;
      if (userTicket) {
        granted = userTicket.granted;
      }
      if (granted === undefined && key.groups) {
        for (const group of key.groups) {
          const groupTicket = await db.collection("groupTickets").findOne({
            group,
          });
          if (groupTicket) {
            granted = groupTicket.granted;
            break;
          }
        }
      }
      // Everyone can open all doors by default!
      if (granted === undefined) {
        granted = true;
      }
      if (granted) {
        await client.publish(`gk/${doorId}/unlock`);
      }
    }
  });
});
