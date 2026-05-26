import express from "express";
import mqtt from "mqtt";
import { MongoClient, ObjectId } from "mongodb";
import bodyParser from "body-parser";
import morgan from "morgan";

import { doorHeartbeats } from "./state.js";
import { syncUsers } from "./sync.js";
import auth from "./auth.js";
import { hybridAuth } from "./middleware/hybridAuth.js";
import { checkAccess } from "./access.js";

// API routes
import memberProjects from "./routes/memberProjects.js";
import doors from "./routes/doors.js";
import keys from "./routes/keys.js";
import users from "./routes/users.js";
import mobile from "./routes/mobile.js";
import logs from "./routes/logs.js";

//fetch user from the https endpoint
async function fetchUser(endpoint, token, memberProjectsId) {
  const url = new URL(`${endpoint}/projects/by-key/${memberProjectsId}`);
  const res = await fetch(url, {
    headers: { Authorization: token },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

// Apparently, automatic reconnection is the default!
const mongoClient = new MongoClient(process.env.GK_MONGO_SERVER, {
  maxPoolSize: 0,
  minPoolSize: 0,
});
const connectionPromise = mongoClient.connect();
connectionPromise.then(async () => {
  console.log("DB Connection opened!");
  const db = mongoClient.db("gatekeeper");

  await Promise.all([
    db.collection("users").createIndex("id", {unique: true}),
    db.collection("keys").createIndex("doorsId", {unique: true}),
    db.collection("keys").createIndex("drinkId", {unique: true}),
    db.collection("keys").createIndex("memberProjectsId", {unique: true}),
    db.collection("accessLogs").createIndex({ timestamp: -1 }),
  ]);

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
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
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
  app.use("/doors", hybridAuth("admin"), doors);
  app.use("/admin/keys", hybridAuth("admin"), keys);
  app.use("/admin/users", hybridAuth("admin"), users);
  app.use("/admin/logs", hybridAuth("admin"), logs);
  app.use("/mobile", mobile);

  client.on("connect", async () => {
    console.log("Connected to MQTT broker!");
    const doors = await db.collection("doors").find({}, {projection: {_id: 1}});
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
      // Fetch user info from HTTP endpoint
      const endpoint = process.env.GK_HTTP_ENDPOINT;
      const token = process.env.GK_SERVER_TOKEN;

      const [userData, doorDoc, granted] = await Promise.all([
        endpoint && token
          ? fetchUser(endpoint, token, key.memberProjectsId).catch((err) => {
              console.error("User fetch failed:", err.message);
              return {};
            })
          : Promise.resolve({}),
        db.collection("doors").findOne({
          $or: [
            { _id: doorId },
            ...(ObjectId.isValid(doorId)
              ? [{ _id: new ObjectId(doorId) }]
              : []),
          ],
        }),
        checkAccess(db, key.userId, doorId),
      ]);

      const user = userData?.user || {};
      const username = user.uid || null;
      const name = user.cn || null;
      // Resolve door name
      const doorName = doorDoc?.name || null;

      //timestamps (DUHHH?)
      const timestamp = new Date();

      // Structured log
      const logEntry = {
        timestamp,
        door: doorId,
        doorName,
        username,
        name,
        doorsId: payload.association,
        keyId: key._id,
        granted: !!granted,
      };

      console.log(logEntry);
      db.collection("accessLogs").insertOne(logEntry).catch((err) => {
        console.error("Failed to insert into DB", err);
      });


      if (granted) {
        console.log(
          `[${timestamp}] ${name} (${username}) is unlocking ${doorName || doorId}`
        );
        client.publish(`gk/${doorId}/unlock`);
      } else {
        console.log(
          `[${timestamp}] Attempted unlock of ${doorName || doorId} by ${name} (${username})! Not allowed...`
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
