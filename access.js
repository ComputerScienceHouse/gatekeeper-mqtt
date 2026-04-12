export async function checkAccess(db, userId, doorId) {
  const dbUser = await db.collection("users").findOne({ id: { $eq: userId } });
  if (!dbUser) return undefined;
  if (dbUser.disabled) return false;

  const userTicket = await db.collection("userTickets").findOne(
    {
      userId: { $in: [userId, "*"] },
      doorId: { $in: [doorId, "*"] },
    },
    { sort: { priority: -1 } }
  );
  if (userTicket !== null) return userTicket.granted;

  const groupTicket = await db.collection("groupTickets").findOne(
    {
      doorId: { $in: ["*", doorId] },
      groupId: { $in: dbUser.groups ? dbUser.groups.concat("*") : ["*"] },
    },
    { sort: { priority: -1 } }
  );
  return groupTicket?.granted;
}
