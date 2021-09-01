const express = require("express");
const mqtt = require("mqtt");
const mongo = require("mongodb");
const bodyParser = require("body-parser");

const {doorHeartbeats} = require("./state");

const auth = require("./auth");

// API routes
const memberProjects = require("./routes/memberProjects");
const doors = require("./routes/doors");
const keys = require("./routes/keys");
const users = require("./routes/users");

// Apparently, automatic reconnection is the default!
const mongoClient = new mongo.MongoClient(process.env.MONGO_HOST);
mongoClient.connect().then(() => {
  const db = mongoClient.db("gatekeeper");

  const client = mqtt.connect(process.env.GK_MQTT_SERVER);

  const app = express();
  app.listen(process.env.GK_HTTP_PORT || 3000);
  app.use(bodyParser.json());
  app.use((req, res, next) => {
    req.ctx = {
      db,
      mqtt: client,
    };
    next();
  });

  app.use(
    "/projects",
    auth("projects"),
    (req, res, next) => {
      req.associationType = "memberProjectsId";
      next();
    },
    memberProjects
  );
  // Make life easier for drink admins for now...
  app.use(
    "/drink",
    auth("drink"),
    (req, res, next) => {
      req.associationType = "drinkId";
      next();
    },
    memberProjects
  );
  app.use("/doors", auth("admin"), doors);
  app.use("/admin/keys", auth("admin"), keys);
  app.use("/admin/users", auth("admin"), users);

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
        doorsId: payload.association,
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
        console.log(
          `Key ${key._id} (Door association: ${key.doorsId}) is unlocking ${doorId}!`
        );
        client.publish(`gk/${doorId}/unlock`);
      } else {
        console.log(
          `Attempted unlock of ${doorId} by ${key._id} (Door association: ${key.doorsId})! Not allowed...`
        );
      }
    } else if (topic.endsWith("/heartbeat")) {
      const doorId = topic.slice(3, -10);
      doorHeartbeats.set(doorId, Date.now());
      console.log(`ACKing a heartbeat from ${doorId}!`);
    }
  });
});
