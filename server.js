const express = require("express");
const mqtt = require("mqtt");
const mongo = require("mongodb");
const bodyParser = require("body-parser");
const crypto = require("crypto");

// Apparently, automatic reconnection is the default!
const mongoClient = new mongo.MongoClient(process.env.MONGO_HOST);
mongoClient.connect().then(() => {
  const db = mongoClient.db("gatekeeper");

  const client = mqtt.connect(process.env.GK_MQTT_SERVER);

  const app = express();
  app.listen(process.env.GK_HTTP_PORT || 3000);
  app.use(bodyParser.json());

  // First, PUT /keys with details of user key is for
  // Receive a keyId back which is our association
  // Register key using association and send back the now-randomised UID
  // with PATCH /keys/:id

  app.put("/keys", async (req, res) => {
    console.log(req.body);
    if (typeof req.body.userId != "string") {
      res.status(422).json({
        message: "No 'userId' field specified",
      });
      return;
    }
    const insertedKey = await db.collection("keys").insertOne({
      // Make sure it's something at least reasonable...
      _id: crypto.randomBytes(18).toString("hex"),
      userId: req.body.userId,
      // Not created yet, so we'll just leave it disabled for now
      enabled: false,
    });
    res.json({
      keyId: insertedKey.insertedId,
    });
  });

  app.put("/users", async (req, res) => {
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
      await db.collection("users").insertOne({
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

  app.get("/users/:id", async (req, res) => {
    const user = await db.collection("users").findOne({id: req.params.id});
    res.json({
      id: user.id,
      groups: user.groups,
    });
  });

  app.patch("/users/:id", async (req, res) => {
    for (const key of ["groups", "id"]) {
      if (key in req.body) {
        updates[key] = req.body[key];
      }
    }
    await db.collection("users").updateOne(
      {id: req.params.id},
      {
        $set: updates,
      }
    );
  });

  app.patch("/keys/:id", async (req, res) => {
    const updates = {};
    for (const key of ["uid", "userId", "enabled"]) {
      if (key in req.body) {
        updates[key] = req.body[key];
      }
    }
    await db.collection("keys").updateOne(
      {
        _id: req.params.id,
      },
      {
        $set: updates,
      }
    );
    res.status(204).send(null);
  });

  app.delete("/keys/by-user", async (req, res) => {
    if (typeof req.body.userId != "string") {
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
    // If it's been more than 1 minute, we assume something is broken...
    const lastHeartbeat = doorHeartbeats.get(req.params.doorId);
    if (lastHeartbeat) {
      res.json({
        guess: Date.now() - lastHeartbeat > 1000 * 60 ? "offline" : "online",
        lastHeartbeat,
      });
    } else {
      res.json({
        guess: "offline",
        lastHeartbeat: 0,
      });
    }
  });

  app.get("/doors", async (req, res) => {
    const doors = await db.collection("doors").find({});
    const entries = [];
    for await (const door of doors) {
      entries.push({
        id: door._id,
        name: door.name,
      });
    }
    res.json({
      doors: entries,
    });
  });

  app.post("/doors/:doorId/unlock", async (req, res) => {
    client.publish(`gk/${req.params.doorId}/unlock`, "");
    res.status(204).send(null);
  });

  client.on("connect", async () => {
    console.log("Connect");
    const doors = await db.collection("doors").find({}, {_id: 1});
    for await (const door of doors) {
      console.log("Subscribing to door", door._id);
      const prefix = `gk/${door._id}/`;
      // client.subscribe(prefix + "fetch_user");
      client.subscribe(prefix + "access_requested");
      client.subscribe(prefix + "heartbeat");
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
    if (topic.endsWith("/access_requested")) {
      const doorId = topic.slice(3, -17);
      const key = await db.collection("keys").findOne({
        _id: payload.association,
        enabled: true,
      });
      // Doesn't exist??
      if (!key) return;
      const userTicket = await db.collection("userTickets").findOne({
        userId: key.userId,
        doorId,
      });
      console.log(userTicket);
      let granted = userTicket?.granted;
      console.log(granted);
      if (granted === undefined) {
        const user = await db.collection("users").findOne({
          id: key.userId,
        });
        if (user) {
          const groupTicket = await db.collection("groupTickets").findOne(
            {
              doorId: {
                $in: ["*", doorId],
              },
              groupId: {
                $in: user.groups ? user.groups.concat("*") : ["*"],
              },
            },
            {
              sort: {
                priority: -1,
              },
            }
          );
          console.log(groupTicket, {
            doorId: {
              $in: ["*", doorId],
            },
            groupId: {
              $in: user.groups ? user.groups.concat("*") : ["*"],
            },
          });
          granted = groupTicket?.granted;
        } else {
          console.log("Why isn't there a user?", key, key.userId);
        }
      }

      // If there's no ticket for the user, assume they're not allowed (undefined)
      if (granted) {
        console.log(`Key ${key._id} is unlocking ${doorId}!`);
        client.publish(`gk/${doorId}/unlock`);
      } else {
        console.log(
          `Attempted unlock of ${doorId} by ${key._id}! Not allowed...`
        );
      }
    } else if (topic.endsWith("/heartbeat")) {
      const doorId = topic.slice(3, -10);
      doorHeartbeats.set(doorId, Date.now());
      console.log(`ACKing a heartbeat from ${doorId}!`);
    }
  });
});
