const {iterableSearch} = require("./util");

async function syncUser(db, user) {
  const id = user.attributes
    .find((attribute) => attribute.type == "ipaUniqueID")
    ._vals[0].toString("utf8");
  const document = {
    groups: user.attributes
      .find((attribute) => attribute.type == "memberOf")
      ._vals.map((value) => value.toString("utf8")),
    disabled:
      user.attributes
        .find((attribute) => attribute.type == "nsAccountLock")
        ?._vals[0].toString("utf8")
        .toLowerCase() == "true",
  };
  await db.collection("users").updateOne(
    {
      id: {
        $eq: id,
      },
    },
    {
      $set: document,
    },
    {upsert: true}
  );
  return {...document, id};
}

async function syncUsers(db) {
  console.log("Running sync job!");
  const cursor = await iterableSearch(
    "cn=users,cn=accounts,dc=csh,dc=rit,dc=edu",
    {
      // filter: "(uid)",
      scope: "one", // one level under user DN (no need to recurse)
      paged: true,
      timeLimit: 60 * 30, // 30 minutes
      attributes: ["memberOf", "ipaUniqueID", "nsAccountLock"],
      sizeLimit: 0, // unlimited
    }
  );
  console.log(cursor);

  let userCount = 0;
  const promises = [];
  // Some day these should be batched...
  // Maybe we could have a map of Group[] => User[] and use `updateMany`?
  // This won't let us upsert, but that should be okay because enroll will fix it?
  for await (const user of cursor) {
    if (!user.attributes.find((attribute) => attribute.type == "ipaUniqueID")) {
      console.log("Missing attributes!", user);
      continue;
    }
    promises.push(syncUser(db, user));
  }
  await Promise.all(promises);
  console.log(`Synced ${promises.length} users!`);
}
module.exports = {
  syncUsers,
  syncUser,
};
