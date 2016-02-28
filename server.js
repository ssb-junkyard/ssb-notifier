#!/bin/sh
':' //; exec "$(which nodejs || which node)" "$0" "$@"
// vi: ft=javascript

var lastTime = Date.now()

var path = require('path')
var ssbKeys = require('ssb-keys')
var ssbClient = require('ssb-client')
var appName = process.env.ssb_appname || 'ssb'
var conf = require('ssb-config/inject')(appName)
var pull = require('pull-stream')

ssbKeys.loadOrCreate(path.join(conf.path, 'secret'), function (err, keys) {
  if (err) throw err
  require('./notifier')(appName, function (err, notify) {
    if (err) throw err

    require('ssb-reconnect')(function (cb) {
      ssbClient(keys, conf, cb)
    }, function (err, sbot, reconnect) {
      if (err) throw err

      sbot.whoami(function (err, feed) {
        if (err) throw err
        showNotifications(sbot, notify, feed.id, function (err) {
          lastTime = Date.now()
          sbot.close(err, function (err) {
            if (err) throw err
            reconnect()
          })
        })
      })
    })
  })
})


function showNotifications(sbot, notify, feedId, cb) {
  pull(
    sbot.createLogStream({
      live: true,
      reverse: true,
      gte: lastTime
    }),
    require('./notifications')(sbot, feedId),
    pull.filter(Boolean),
    pull.drain(notify, cb)
  )
}
