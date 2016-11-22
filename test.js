#!/usr/bin/env node

require('ssb-client')(process.env.ssb_appname, function (err, sbot) {
  if (err) throw err
  sbot.whoami(function (err, feed) {
    if (err) throw err
    sbot.id = feed.id
    var hrs = Number(process.argv[2]) || 1
    console.log('Loading notifications from the past ' + hrs + ' hours')
    require('.').init(sbot, {notifier: {
      recent: hrs*3600*1000
    }}, function (err) {
      if (err) throw err
      process.exit(0)
    })
  })
})
