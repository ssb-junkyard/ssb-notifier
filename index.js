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
      if (err) return console.error('[notifier]', err.message || err)
      pull(
        sbot.createLogStream({old: false}),
        require('./notifications')(sbot, sbot.id),
        pull.drain(notify, function (err) {
          console.error('[notifier]', err)
        })
      )
    })
  }
}