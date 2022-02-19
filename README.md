# Gatekeeper MQTT

Gatekeeper MQTT is an MQTT listener for the Gatekeeper access control system!

## Permissions

Gatekeeper has support for robust permissions based on groups and users.
We call these permissions "tickets". If a user or their group has a valid ticket,
they can open a door!

### Example Group Ticket

Here is an example group ticket. It allows any current student to open any door.
This ticket has a priority of 100. Tickets can be created with a higher priority
to override this ticket's effect. If no tickets match for a given user, they
cannot open any doors.

```
{
    "doorId" : "*",
    "groupId" : "cn=current_student,cn=groups,cn=accounts,dc=csh,dc=rit,dc=edu",
    "priority" : 100,
    "granted" : true
}
```

Group tickets live in the `groupTickets` collection.

_Note: `groupId` and `doorId` can be `*` to allow any group or any door_

### Example User Ticket

User tickets work in much the same way:

```
{
    "userId": "087aa316-0eb3-11ec-a60b-62123a302540",
    "doorId": "*",
    "priority": 100,
    "granted": false,
}
```

_Note: `groupId` and `doorId` can be `*` to allow any group or any door_
