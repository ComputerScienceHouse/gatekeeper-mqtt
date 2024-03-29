const express = require("express");
const mqtt = require("mqtt");
const mongo = require("mongodb");
const bodyParser = require("body-parser");
const morgan = require("morgan");

const {doorHeartbeats} = require("./state");
const {syncUsers} = require("./sync");

const auth = require("./auth");

// API routes
const memberProjects = require("./routes/memberProjects");
const doors = require("./routes/doors");
const keys = require("./routes/keys");
const users = require("./routes/users");
const mobile = require("./routes/mobile");

// Apparently, automatic reconnection is the default!
const mongoClient = new mongo.MongoClient(process.env.GK_MONGO_SERVER, {
  maxPoolSize: 0,
  minPoolSize: 0,
});
const connectionPromise = mongoClient.connect();
connectionPromise.then(async () => {
  console.log("DB Connection opened!");
  const db = mongoClient.db("gatekeeper");

  await db.collection("users").createIndex("id", {unique: true});
  await db.collection("keys").createIndex("doorsId", {unique: true});
  await db.collection("keys").createIndex("drinkId", {unique: true});
  await db.collection("keys").createIndex("memberProjectsId", {unique: true});

  async function scheduledTasks() {
    console.log("Scheduled task time!");
    await syncUsers(db);
    console.log("Tasks completed. Running again in 5 minutes!");
    // 5 minutes
    setTimeout(scheduledTasks, 1000 * 60 * 5);
  }
  if (process.env.NODE_ENV == "development") {
    scheduledTasks();
  } else {
    const backoff = Math.floor(Math.random() * 1000 * 60 * 60);
    console.log(
      `Production. Running our work tasks in ${backoff / 1000 / 60} minutes`
    );
    setTimeout(scheduledTasks, backoff);
  }

  console.log("Opening MQTT @", process.env.GK_MQTT_SERVER);
  const client = mqtt.connect(process.env.GK_MQTT_SERVER, {
    username: process.env.GK_MQTT_USERNAME,
    password: process.env.GK_MQTT_PASSWORD,

    reconnectPeriod: 1000,
    rejectUnauthorized: false,
  });

  client.on("error", (err) => {
    console.log("MQTT errored!", err);
  });
  client.on("offline", () => {
    console.log("Client went offline?");
  });

  const app = express();
  app.listen(process.env.GK_HTTP_PORT || 3000, '0.0.0.0');
  app.use(
    morgan(":method :url :status :res[content-length] - :response-time ms")
  );
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
  app.use("/mobile", mobile);

  client.on("connect", async () => {
    console.log("Connected to MQTT broker!");
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
    console.log("Got a message from server", topic, message);
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
        doorsId: {$eq: payload.association},
        enabled: {$eq: true},
      });
      // Doesn't exist??
      if (!key) return;
      const user = await db.collection("users").findOne({
        id: {$eq: key.userId},
      });
      if (!user) {
        console.log("No user found for key?", key);
        return;
      }
      let granted = undefined;
      if (user.disabled) {
        granted = false;
      }
      // This could be an `else if`, but this feels a little more consistent / cleaner
      if (granted === undefined) {
        const userTicket = await db.collection("userTickets").findOne(
          {
            userId: {$in: [key.userId, "*"]},
            doorId: {$in: [doorId, "*"]},
          },
          {
            sort: {
              priority: -1,
            },
          }
        );
        console.log(userTicket);
        granted = userTicket?.granted;
      }
      if (granted === undefined) {
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
        console.log(
          `Found a group ticket for door=${doorId}/user=${user.id} pair!`,
          groupTicket
        );
        granted = groupTicket?.granted;
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
connectionPromise.catch((err) => {
  console.error("Failed connecting to mongo", err);
});
