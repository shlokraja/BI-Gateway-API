var pg = require('pg');
var DB_CONN="postgres://postgres:postgres@192.168.1.147/foodbox_VPA_LIVE";
//var DB_CONN="postgres://postgres:shlok123@192.168.0.75/foodbox";
module.exports = {
    dbConn:  DB_CONN || "postgres://localhost/testdb",
    query: function(text, values, cb) {
      pg.connect(DB_CONN, function(err, client, done) {
        if (err) {
          done(client);
          cb(err, null);
          return;
        }
        client.query(text, values, function(err, result) {
          if(err){
            done(client);
            cb(err, null);
          }
          done();
          cb(null, result);
        });
      });
   }
};

