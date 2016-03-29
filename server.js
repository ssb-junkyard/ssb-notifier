#!/bin/sh
':' //; exec "$(which nodejs || which node)" "$0" "$@"
// vi: ft=javascript

var appName = process.env.ssb_appname || 'ssb'
var pull = require('pull-stream')

module.exports = {
  name: 'notifier',
  version: '1.0.0',
  manifest: {},
  permissions: {
    master: {allow: []}
  },
  init: function (sbot, config) {
    require('./notifier')(appName, function (err, notify) {
      if (err) throw err
      pull(
        sbot.createLogStream({
          live: true,
          reverse: true,
          gte: Date.now()
        }),
        require('./notifications')(sbot, sbot.id),
        pull.filter(Boolean),
        pull.drain(notify)
      )
    })
  }
}