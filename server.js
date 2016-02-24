#!/bin/sh
':' //; exec "$(which nodejs || which node)" "$0" "$@"
// vi: ft=javascript

var path = require('path')
var ssbKeys = require('ssb-keys')
var appName = process.env.ssb_appname || 'ssb'
var conf = require('ssb-config/inject')(appName)
var notifier = require('node-notifier')
var pull = require('pull-stream')

ssbKeys.loadOrCreate(path.join(conf.path, 'secret'), function (err, keys) {
  if (err) throw err
  require('ssb-client')(keys, conf, function (err, sbot) {
    if (err) throw err
    sbot.whoami(function (err, feed) {
      if (err) return cb(err)
      var keepalive = setInterval(sbot.whoami, 15e3)
      showNotifications(sbot, feed.id, function (err) {
        clearTimeout(keepalive)
        sbot.close(err, function (err) {
          if (err) throw err
          // TODO: try reconnecting
        })
      })
    })
  })
})

function showNotifications(sbot, feedId, cb) {
  pull(
    sbot.createLogStream({
      live: true,
      reverse: true,
      gte: Date.now()
    }),
    require('./notifications')(sbot, feedId),
    pull.drain(function (notif) {
      if (!notif) return
      notif.name = appName
      notifier.notify(notif)
    }, cb)
  )
}
