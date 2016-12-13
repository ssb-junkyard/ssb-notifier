#!/usr/bin/env node

require('ssb-client')(function (err, sbot) {
  if (err) throw err
  require('.').init(sbot)
})
