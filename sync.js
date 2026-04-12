import { iterableSearch } from "./util.js";

export async function syncUser(db, user) {
  const id = user.attributes
    .find((attribute) => attribute.type == "ipaUniqueID")
    ._vals[0].toString("utf8");
  let memberOf = user.attributes
    .find((attribute) => attribute.type == "memberOf");
  if (!memberOf)
    return;
  const document = {
    groups: memberOf._vals.map((value) => value.toString("utf8")),
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

export async function syncUsers(db) {
  console.log("Running sync job!");
  const cursor = await iterableSearch(
    "cn=users,cn=accounts,dc=csh,dc=rit,dc=edu",
    {
      scope: "one",
      paged: true,
      timeLimit: 60 * 30, // 30 minutes
      attributes: ["memberOf", "ipaUniqueID", "nsAccountLock"],
      sizeLimit: 0, // unlimited
    }
  );

  const promises = [];
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
