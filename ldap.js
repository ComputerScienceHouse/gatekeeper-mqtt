const dns = require("dns");
const util = require("util");
const ldap = require("ldapjs");
const resolve = util.promisify(dns.resolveSrv);

// TODO: This is a race condition!
resolve("_ldap._tcp.csh.rit.edu").then((records) => {
  module.exports.client = ldap.createClient({
    url: records.map((record) => `ldap://${record.name}:${record.port}`),
  });
  module.exports.client.bind(
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
