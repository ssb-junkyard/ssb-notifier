module.exports = function init(appName, cb) {
  switch (require('os').type()) {

    case 'Linux':
      var notifications = require('freedesktop-notifications')
      var proc = require('child_process')
      return notifications.init(function (err) {
        if (err) return cb(err)
          notifications.setAppName(appName)
        cb(null, function (notif) {
          var notification = notifications.createNotification({
            summary: notif.title,
            body: notif.message,
            actions: {
              default: 'Open'
            },
            // https://developer.gnome.org/notification-spec/#hints
            'desktop-entry': 'ssb-patchwork-electron'
          })
          notification.on('action', function (action) {
            proc.spawn('xdg-open', [notif.open], {stdio: 'inherit'}).unref()
          });
          notification.push()
        })
      })

    default:
      var notifier = require('node-notifier')
      cb(null, function (notif) {
        notif.name = appName
        notifier.notify(notif)
      })
  }
}
