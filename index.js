var appName = process.env.ssb_appname || 'ssb'
var pull = require('pull-stream')

module.exports = {
  name: 'notifier',
  version: '1.0.0',
  manifest: {},
  permissions: {
    master: {allow: []}
  },
  init: function (sbot, config, opts) {
    var logOpts = {live: true}
    if (opts && !isNaN(opts.recent)) {
      logOpts.gte = Date.now() - opts.recent
    } else {
      logOpts.old = false
    }
    require('./notifier')(appName, function (err, notify) {
      if (err) return console.error('[notifier]', err.message || err)
      pull(
        sbot.createLogStream(logOpts),
        require('./notifications')(sbot, sbot.id),
        pull.drain(notify, function (err) {
          console.error('[notifier]', err)
        })
      )
    })
  }
}