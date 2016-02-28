#!/bin/sh
':' //; exec "$(which nodejs || which node)" "$0" "$@"
// vi: ft=javascript

var path = require('path')
var ssbKeys = require('ssb-keys')
var ssbClient = require('ssb-client')
var appName = process.env.ssb_appname || 'ssb'
var conf = require('ssb-config/inject')(appName)
var pull = require('pull-stream')

function reconnecter(createClient, onConnection) {
  var keepaliveInterval = 15e3
  var rpc
  var reconnectDelay
  var awaitingReconnect

  function keepalive() {
    rpc.whoami(function (err, feed) {
      if (err) connect()
      else setTimeout(keepalive, keepaliveInterval)
    })
  }

  function connect() {
    reconnectDelay = 1e3
    if (awaitingReconnect)
      clearTimeout(awaitingReconnect)
    function reconnect() {
      createClient(function (err, _rpc) {
        awaitingReconnect = null
        if (err) {
          awaitingReconnect = setTimeout(reconnect, reconnectDelay *= 1.618)
        } else {
          rpc = _rpc
          setTimeout(keepalive, keepaliveInterval)
          onConnection(null, rpc, connect)
        }
      })
    }
    reconnect()
  }

  connect()
}

ssbKeys.loadOrCreate(path.join(conf.path, 'secret'), function (err, keys) {
  if (err) throw err
  require('./notifier')(appName, function (err, notify) {
    if (err) throw err

    reconnecter(function (cb) {
      ssbClient(keys, conf, cb)
    }, function (err, sbot, reconnect) {
      if (err) throw err

      sbot.whoami(function (err, feed) {
        if (err) throw err
        showNotifications(sbot, notify, feed.id, function (err) {
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
      gte: Date.now()
    }),
    require('./notifications')(sbot, feedId),
    pull.filter(Boolean),
    pull.drain(notify, cb)
  )
}
