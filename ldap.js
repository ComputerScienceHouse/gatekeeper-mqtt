import dns from "dns";
import { promisify } from "util";
import ldapjs from "ldapjs";

const resolve = promisify(dns.resolveSrv);

// TODO: This is a race condition!
export let client;

export function searchOne(base, filter, attributes) {
  return new Promise((resolve, reject) => {
    client.search(
      base,
      {
        filter,
        scope: "one",
        paged: false,
        sizeLimit: 1,
        ...(attributes && { attributes }),
      },
      (err, res) => {
        if (err) {
          reject(err);
        } else {
          function onSearchEntry(entry) {
            resolve(entry);
            res.removeListener("end", onEnd);
          }
          function onEnd() {
            res.removeListener("searchEntry", onSearchEntry);
            reject(new Error("User not found!"));
          }
          res.once("searchEntry", onSearchEntry);
          res.once("end", onEnd);
        }
      }
    );
  });
}

resolve("_ldap._tcp.csh.rit.edu").then((records) => {
  client = ldapjs.createClient({
    url: records.map((record) => `ldap://${record.name}:${record.port}`),
    reconnect: true,
  });
  client.on("connect", () => {
    console.log("Client connected. Binding...");
    client.bind(
      process.env.GK_LDAP_BIND_DN,
      process.env.GK_LDAP_PASSWORD,
      (err) => {
        if (err) {
          throw err;
        }
        console.log("LDAP is bound!");
      }
    );
  });
});
