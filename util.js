const ldap = require("./ldap");

function iterableSearch(base, options) {
  return new Promise((resolve, reject) => {
    ldap.client.search(base, options, (err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve({
          async *[Symbol.asyncIterator]() {
            let entries = [];
            let foundEnd = false;
            // Used internally for generator, allow waiting for next tick
            let fire = null;
            function onSearchEntry(entry) {
              entries.push(entry);
              if (fire) {
                fire();
              }
            }
            function onEnd() {
              console.log("Found an end!");
              foundEnd = true;
              // Don't leak memory:
              res.removeListener("searchEntry", onSearchEntry);
              res.removeListener("error", onError);
              if (fire) {
                fire();
              }
            }
            function onError(err) {
              console.log("Found an error!", err);
              entries.push(Promise.reject(err));
              foundEnd = true;
              res.removeListener("end", onEnd);
              res.removeListener("searchEntry", onSearchEntry);
              if (fire) {
                fire();
              }
            }
            res.on("searchEntry", onSearchEntry);
            res.once("end", onEnd);
            res.once("error", onError);

            while (!foundEnd) {
              while (entries.length) {
                const entriesClone = entries;
                entries = [];
                // console.log(`Pumping ${entriesClone.length} entries!`);
                yield* entriesClone;
                // console.log("Pumped!");
              }
              if (!foundEnd) {
                // Waits for next chunk to be dispatched from the system
                await new Promise((resolve, reject) => {
                  // Safety check, make sure we don't deadlock
                  // (even though this call should be immediate)
                  if (entries.length) {
                    resolve();
                  } else {
                    fire = () => {
                      fire = null;
                      resolve();
                    };
                  }
                });
              }
            }
          },
        });
      }
    });
  });
}
module.exports = {
  iterableSearch,
};
